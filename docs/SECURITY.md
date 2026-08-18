# Security policy and deployment checklist

## Reporting a vulnerability

Do not disclose exploitable details in a public issue. Contact the repository owner privately with affected versions, reproduction steps, and impact. Do not access other users' information, disrupt service, or retain sensitive data while testing.

## Threat model

The API treats browser input, bearer tokens, identifiers, amounts, proxy headers, and provider callbacks as untrusted. Main risks include account takeover, broken object authorization, replayed financial requests, brute force, injection, sensitive-data leakage, fraudulent state changes, and balance corruption.

## Required controls before production

The included baseline is not sufficient for custody of funds. A production review must cover:

- TLS/HSTS at the edge, a strict origin allowlist, and trusted-proxy configuration.
- Managed secrets with rotation; never place real secrets in `.env` files or Git.
- MFA and step-up authentication for withdrawals, profile changes, and payout destinations.
- Short-lived access tokens plus rotating, revocable refresh sessions in secure HttpOnly cookies.
- Durable per-account and per-IP rate limits shared across API replicas.
- ACID double-entry ledger, database constraints, serializable money movement, reconciliation, and backups with restore drills.
- KYC/AML, sanctions screening, transaction monitoring, cooling-off periods, limits, and manual review appropriate to operating jurisdictions.
- Signed and timestamped provider webhooks with replay protection.
- Immutable, access-controlled audit events without passwords, tokens, full bank details, or unnecessary personal data.
- Dependency and secret scanning, SAST/DAST, penetration testing, incident response, and key-compromise runbooks.
- Data classification, encryption at rest, retention/deletion rules, and least-privilege access reviews.

## Application notes

`ALLOWED_ORIGINS` is enforced when `NODE_ENV=production`. `JWT_SECRET` must be random and at least 32 characters; 32 random **bytes** or more are recommended. The current in-memory stores intentionally contain no seed credentials and are suitable only for development and automated verification.
