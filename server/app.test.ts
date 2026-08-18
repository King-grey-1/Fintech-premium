import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from './app.js'

const secret = 'test-secret-that-is-at-least-thirty-two-characters'
const user = { name: 'Alex Kim', email: 'alex@example.com', password: 'correct-horse-battery-staple' }

async function register(app: ReturnType<typeof createApp>, body = user) {
  return request(app).post('/api/v1/auth/register').send(body)
}

describe('Capitalia API', () => {
  it('reports health without exposing framework details', async () => {
    const response = await request(createApp({ jwtSecret: secret })).get('/api/v1/health').expect(200)
    assert.deepEqual(response.body, { status: 'ok' })
    assert.equal(response.headers['x-powered-by'], undefined)
    assert.ok(response.headers['x-content-type-options'])
  })

  it('registers, logs in, and returns only public profile fields', async () => {
    const app = createApp({ jwtSecret: secret })
    const created = await register(app)
    assert.equal(created.status, 201)
    assert.equal(created.body.data.user.email, user.email)
    assert.equal(created.body.data.user.passwordHash, undefined)
    assert.ok(created.body.data.accessToken)

    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password }).expect(200)
    const profile = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${login.body.data.accessToken}`).expect(200)
    assert.equal(profile.body.data.name, user.name)
  })

  it('rejects weak credentials and protects private routes', async () => {
    const app = createApp({ jwtSecret: secret })
    await register(app, { ...user, password: 'short' }).then(response => assert.equal(response.status, 400))
    await request(app).get('/api/v1/transactions').expect(401)
    await request(app).get('/api/v1/transactions').set('Authorization', 'Bearer invalid').expect(401)
  })

  it('scopes transactions to their owner', async () => {
    const app = createApp({ jwtSecret: secret })
    const first = await register(app)
    const second = await register(app, { ...user, email: 'second@example.com' })
    const firstToken = first.body.data.accessToken
    const secondToken = second.body.data.accessToken

    await request(app).post('/api/v1/deposits').set('Authorization', `Bearer ${firstToken}`).set('Idempotency-Key', 'deposit-001').send({ amount: 250.25, reference: 'BANK-42' }).expect(202)
    const own = await request(app).get('/api/v1/transactions').set('Authorization', `Bearer ${firstToken}`).expect(200)
    const other = await request(app).get('/api/v1/transactions').set('Authorization', `Bearer ${secondToken}`).expect(200)
    assert.equal(own.body.meta.count, 1)
    assert.equal(other.body.meta.count, 0)
  })

  it('uses integer cents and safely replays idempotent financial requests', async () => {
    const app = createApp({ jwtSecret: secret })
    const created = await register(app)
    const auth = { Authorization: `Bearer ${created.body.data.accessToken}`, 'Idempotency-Key': 'request-12345' }
    const first = await request(app).post('/api/v1/withdrawals').set(auth).send({ amount: 10.99 }).expect(202)
    const replay = await request(app).post('/api/v1/withdrawals').set(auth).send({ amount: 999 }).expect(200)
    assert.equal(first.body.data.amountCents, 1099)
    assert.equal(replay.body.data.id, first.body.data.id)
    assert.equal(replay.body.meta.replayed, true)
  })

  it('validates money and requires an idempotency key', async () => {
    const app = createApp({ jwtSecret: secret })
    const created = await register(app)
    const token = `Bearer ${created.body.data.accessToken}`
    await request(app).post('/api/v1/deposits').set('Authorization', token).send({ amount: 1 }).expect(400)
    await request(app).post('/api/v1/deposits').set('Authorization', token).set('Idempotency-Key', 'valid-key').send({ amount: 1.001 }).expect(400)
  })
})
