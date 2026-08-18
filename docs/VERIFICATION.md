# Verification strategy

`npm run verify` is the release gate and runs:

1. Client and server TypeScript checks.
2. HTTP-level API tests with an isolated application/store per test.
3. The optimized Vite production build.
4. `npm audit` with failure at high or critical severity.

The API suite covers defensive headers, account creation and login, secret-field redaction, weak-password validation, unauthenticated and invalid-token denial, cross-user transaction isolation, integer-cent conversion, idempotent retries, and malformed financial requests.

For production, add database integration tests, concurrent ledger/property tests, provider contract tests, migration tests, browser end-to-end tests, and security tests for refresh-token rotation, MFA, webhook signatures, and authorization across every object type.
