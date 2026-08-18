# Architecture

## Current boundaries

```text
Browser -> Vite/edge server -> /api/v1 -> Express middleware -> route/domain handlers -> in-memory stores
```

`createApp()` is separate from the listening process so the complete HTTP stack can be integration-tested without opening a network port. Authentication establishes the user subject before private handlers execute. Every query filters records by that subject.

## Financial request lifecycle

Deposit and withdrawal requests accept decimal amounts at the boundary, validate at most two decimal places, and immediately convert to integer cents. New requests are `pending`; this API never claims that money moved. A client-provided idempotency key is scoped to the user and operation, ensuring retries return the original result rather than creating duplicates.

## Production evolution

Before real use, replace in-memory maps with a durable ACID data store. Recommended boundaries are:

1. **Identity:** managed identity service with MFA, breached-password detection, token revocation, and recovery controls.
2. **Ledger:** append-only, double-entry ledger. Never derive authoritative balances from mutable transaction rows.
3. **Workflow:** explicit state transitions with maker-checker approval for withdrawals.
4. **Integrations:** isolated adapters for custody/payment providers with signed, replay-protected webhooks.
5. **Events:** transactional outbox feeding notifications, reconciliation, and immutable audit storage.
6. **Observability:** redacted structured logs, metrics, traces, and alerts with correlation IDs.

Run multiple stateless API replicas behind TLS termination. Keep secrets in a managed secret store, apply schema migrations as a separate deployment step, and use least-privilege service identities.
