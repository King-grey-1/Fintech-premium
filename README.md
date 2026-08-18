# Capitalia

Capitalia is a responsive investment-account experience with a security-focused HTTP API. The repository contains a React/Vite client and an Express/TypeScript API.

> **Important:** This is application scaffolding, not a licensed custodian or investment service. Balances and requests are held in memory and are lost when the API restarts. Connect an audited transactional database, an identity provider, KYC/AML controls, and regulated payment/custody providers before handling real funds.

## Requirements

- Node.js 20 or later
- npm 10 or later

## Quick start

```bash
npm ci
cp .env.example .env
# Replace JWT_SECRET with: openssl rand -hex 32
npm run dev:api       # API at http://localhost:3001
npm run dev           # web client at http://localhost:5173
```

The current UI is a high-fidelity prototype and uses illustrative data. API integration should use relative `/api` URLs behind a same-origin reverse proxy in production.

## Verification

```bash
npm run verify
```

This runs strict TypeScript checks for client and server, API integration tests, the production web build, and a high-severity dependency audit.

## API

All routes are under `/api/v1`. Protected routes require `Authorization: Bearer <token>`. Financial POST routes also require a unique `Idempotency-Key` header (8–100 safe ASCII characters).

| Method | Route | Authentication | Purpose |
|---|---|---:|---|
| GET | `/health` | No | Liveness check |
| POST | `/auth/register` | No | Create an account and issue a 15-minute token |
| POST | `/auth/login` | No | Authenticate and issue a 15-minute token |
| GET | `/me` | Yes | Return the current public profile |
| GET | `/portfolio` | Yes | Return the current user's aggregate balance in integer cents |
| GET | `/transactions` | Yes | List only the current user's requests |
| POST | `/deposits` | Yes | Submit an idempotent pending deposit request |
| POST | `/withdrawals` | Yes | Submit an idempotent pending withdrawal request |

Example:

```bash
curl -s http://localhost:3001/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"name":"Alex Kim","email":"alex@example.com","password":"a-long-unique-passphrase"}'

curl -s http://localhost:3001/api/v1/deposits \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: deposit-2026-0001' \
  -d '{"amount":250.25,"reference":"BANK-42"}'
```

Successful responses use `{ "data": ... }`; failures use `{ "error": { "code", "message", "details"? } }`. Monetary values returned by the API use integer cents to avoid floating-point accounting errors.

## Security baseline

- Passwords are hashed with bcrypt (cost 12), never returned by the API.
- JWTs are algorithm-, issuer-, and audience-constrained and expire after 15 minutes.
- Auth and financial endpoints are rate-limited.
- Helmet supplies defensive browser headers; Express identity headers are disabled.
- Request bodies are limited to 32 KB and parsed with strict Zod schemas.
- CORS uses an explicit production allowlist.
- User-owned resources are filtered by the authenticated subject.
- Financial writes are idempotent and initially recorded as `pending`.
- Production startup fails closed if `JWT_SECRET` is missing or shorter than 32 characters.

See [docs/SECURITY.md](docs/SECURITY.md) for production controls and responsible disclosure guidance.

## Project structure

```text
src/                 React client
server/app.ts        API composition and domain routes
server/index.ts      API process entry point
server/app.test.ts   API integration and security tests
docs/                Architecture and security guidance
```
