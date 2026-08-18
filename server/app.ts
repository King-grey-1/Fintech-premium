import bcrypt from 'bcryptjs'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { z, ZodError } from 'zod'

export type AppOptions = {
  jwtSecret?: string
  allowedOrigins?: string[]
  trustProxy?: boolean
}

type User = { id: string; name: string; email: string; passwordHash: string; referralCode: string; createdAt: string }
type Transaction = {
  id: string; userId: string; type: 'deposit' | 'withdrawal'; amountCents: number
  currency: 'USD'; status: 'pending'; reference?: string; createdAt: string
}
type AuthRequest = Request & { user?: User }

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
})
const registerSchema = credentialsSchema.extend({ name: z.string().trim().min(2).max(80) })
const moneySchema = z.object({
  amount: z.number().finite().positive().max(1_000_000).refine(value => Number.isInteger(value * 100), 'Use no more than two decimal places'),
  reference: z.string().trim().min(3).max(100).optional(),
})
const idempotencySchema = z.string().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/)

function publicUser(user: User) {
  const { passwordHash: _, ...safe } = user
  return safe
}

export function createApp(options: AppOptions = {}) {
  const isProduction = process.env.NODE_ENV === 'production'
  const secret = options.jwtSecret ?? process.env.JWT_SECRET ?? (isProduction ? '' : 'development-only-secret-change-me')
  if (secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters')

  const users = new Map<string, User>()
  const usersByEmail = new Map<string, User>()
  const transactions = new Map<string, Transaction>()
  const idempotencyResults = new Map<string, Transaction>()
  const app = express()

  if (options.trustProxy ?? isProduction) app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      const allowed = options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)
      if (!origin || !isProduction || allowed.includes(origin)) return callback(null, true)
      callback(new Error('Origin is not allowed'))
    },
    credentials: true,
  }))
  app.use(express.json({ limit: '32kb' }))

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false })
  const financialLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })

  function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
    const value = req.header('authorization')
    if (!value?.startsWith('Bearer ')) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'A bearer token is required' } })
    try {
      const claims = jwt.verify(value.slice(7), secret, { algorithms: ['HS256'], issuer: 'capitalia-api', audience: 'capitalia-web' })
      const user = typeof claims !== 'string' ? users.get(claims.sub ?? '') : undefined
      if (!user) throw new Error('Unknown user')
      req.user = user
      next()
    } catch {
      res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'The access token is invalid or expired' } })
    }
  }

  function issueToken(user: User) {
    return jwt.sign({}, secret, { algorithm: 'HS256', subject: user.id, issuer: 'capitalia-api', audience: 'capitalia-web', expiresIn: '15m' })
  }

  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }))

  app.post('/api/v1/auth/register', authLimiter, async (req, res, next) => {
    try {
      const input = registerSchema.parse(req.body)
      if (usersByEmail.has(input.email)) return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'An account already exists for this email' } })
      const user: User = {
        id: randomUUID(), name: input.name, email: input.email,
        passwordHash: await bcrypt.hash(input.password, 12), referralCode: randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase(),
        createdAt: new Date().toISOString(),
      }
      users.set(user.id, user); usersByEmail.set(user.email, user)
      res.status(201).json({ data: { user: publicUser(user), accessToken: issueToken(user), expiresIn: 900 } })
    } catch (error) { next(error) }
  })

  app.post('/api/v1/auth/login', authLimiter, async (req, res, next) => {
    try {
      const input = credentialsSchema.parse(req.body)
      const user = usersByEmail.get(input.email)
      if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
        return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } })
      }
      res.json({ data: { user: publicUser(user), accessToken: issueToken(user), expiresIn: 900 } })
    } catch (error) { next(error) }
  })

  app.get('/api/v1/me', authenticate, (req: AuthRequest, res) => res.json({ data: publicUser(req.user!) }))

  app.get('/api/v1/portfolio', authenticate, (req: AuthRequest, res) => {
    const own = [...transactions.values()].filter(item => item.userId === req.user!.id)
    const deposits = own.filter(item => item.type === 'deposit').reduce((sum, item) => sum + item.amountCents, 0)
    const withdrawals = own.filter(item => item.type === 'withdrawal').reduce((sum, item) => sum + item.amountCents, 0)
    res.json({ data: { currency: 'USD', depositedCents: deposits, withdrawnCents: withdrawals, availableCents: deposits - withdrawals } })
  })

  app.get('/api/v1/transactions', authenticate, (req: AuthRequest, res) => {
    const data = [...transactions.values()].filter(item => item.userId === req.user!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    res.json({ data, meta: { count: data.length } })
  })

  function financialRoute(type: Transaction['type']) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const input = moneySchema.parse(req.body)
        const key = idempotencySchema.parse(req.header('idempotency-key'))
        const scopedKey = `${req.user!.id}:${type}:${key}`
        const existing = idempotencyResults.get(scopedKey)
        if (existing) return res.status(200).json({ data: existing, meta: { replayed: true } })
        const item: Transaction = { id: randomUUID(), userId: req.user!.id, type, amountCents: Math.round(input.amount * 100), currency: 'USD', status: 'pending', reference: input.reference, createdAt: new Date().toISOString() }
        transactions.set(item.id, item); idempotencyResults.set(scopedKey, item)
        res.status(202).json({ data: item, meta: { replayed: false } })
      } catch (error) { next(error) }
    }
  }

  app.post('/api/v1/deposits', financialLimiter, authenticate, financialRoute('deposit'))
  app.post('/api/v1/withdrawals', financialLimiter, authenticate, financialRoute('withdrawal'))

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }))
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.flatten().fieldErrors } })
    if (error instanceof SyntaxError) return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } })
    console.error(error)
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } })
  })

  return app
}
