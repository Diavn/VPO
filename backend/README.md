# VPO V4.4 — synthetic backend foundation (not deployed)

This branch is intentionally not merged into the GitHub Pages root. Node.js 22+, PostgreSQL 16+; dependencies must be installed and reviewed, including lockfile generation and vulnerability scanning. The server binds only to 127.0.0.1. Use a fresh isolated staging database, synthetic accounts ending @example.test, no real student data. Do not expose it to the internet. Production requires a separate managed deployment and approval.

## Quick start (local developer)
1. Create a fresh staging database. A DBA creates separate restricted login roles vpo_runtime and vpo_provision with secrets outside Git. Run schema.sql and grants.sql as migration owner; do not run against the legacy database or V3.4 full schema.
2. In backend/ run npm install --ignore-scripts, review package-lock.json and run npm audit; then npm test. Pin and review transitive versions before deployment.
3. Set VPO_MODE=synthetic-staging, VPO_ORIGIN=http://localhost:8080, VPO_PORT=8080, VPO_CSRF_KEY (32 random bytes hex; e.g. openssl rand -hex 32), DATABASE_URL securely in shell or secret manager. No credentials in Git or shell history. Initially use the provisioning-role connection, then provision a fake account with a password entered privately through stdin: read -rs P; printf '%s\n' "$P" | node provision.cjs learner@example.test; unset P. Use a unique staging password at least 15 UTF-8 bytes.
4. Switch DATABASE_URL to runtime role, npm start. Access local API with exact Host localhost:8080. For POST/PATCH send Origin http://localhost:8080; login and patch use JSON. Store returned cookie and CSRF in test client memory, not in repository. PATCH and logout require X-CSRF-Token. No frontend is connected.
5. GET /healthz; POST /auth/login with {email,password}; GET /me; PATCH /me/profile with {grade,curriculum,locale,version}; POST /auth/logout. Only enumerated synthetic fields accepted, no user_id. No public registration or staff role.

## Mapping and boundary
V3.4 API003 GET /me and API004 PATCH /me/profile partially implemented. Login/logout are supporting routes. V3.4 schema users, role_grants and student_profiles are represented by a deliberately reduced vpo_stage slice; sessions and login_limits are new runtime tables; audit_events is a reduced audit ledger. Not a replacement/migration of 53-table schema. API001/002 registration/verification and API005/006 evidence remain disabled. No official eligibility, payments, assessment, or exam data. No profile review state exists yet; no actual verified profiles can be created.

Controls: scrypt with random salt; bounded hashing concurrency and database rate limits; hashed random session tokens; 8-hour absolute/30-minute idle expiry; exact Host/Origin; CSRF header bound to session; secure cookies on HTTPS origin; parameterized SQL, strict profile allowlist, self scope, optimistic versioning, transactional audit; no CORS; no upload endpoints. HTTP only for localhost. TLS, reverse proxy headers, DB TLS, actual environment least privilege and shared rate-limiting under realistic loads must be verified. The global login quota can be exhausted intentionally; replace with a layered gateway and load-tested per-client throttling before external staging.

## Go/no-go
Not production. Staff roles and MFA, OIDC/email verification, password reset/revocation workflow, verified guardian handling, data encryption and KMS, evidence storage/quarantine/scanning, privacy workflow, full audit/monitoring, WAF, backups, real RBAC/RLS, independent security tests, dependency lockfile, database integration tests and exam gates all outstanding. Tests are provided, not certification. Keep current GitHub Pages demo disconnected. No real account/identity data or payment information until BTC approves G0–G4 and security acceptance.

## Verification record — 2026-11-25
All four original CJS files and package.json passed JavaScript/JSON parsing. Six Node.js 22.16.0 unit tests passed on exact copies of security.cjs and tests/security.test.cjs (verified Git blob hashes df8ce8e25c0826d2cfdb885638226bafa603b7ca and 0b1dc11d9b34e50a8c15d9b23b540ef71364dc14). This verifies helpers, not running API or SQL. PostgreSQL and pg dependency installation were unavailable for this run. No migration or HTTP integration tests were run.

After installing dependencies and starting local staging, provision two fake accounts and supply VPO_TEST_A_EMAIL, VPO_TEST_B_EMAIL, VPO_TEST_A_PASSWORD, VPO_TEST_B_PASSWORD privately. With VPO_MODE and VPO_ORIGIN set, run `node tests/integration-smoke.cjs`. It mutates the first fake profile, checks cross-account isolation, CSRF, stale version, disabled registration/upload, logout, and should only be used against disposable fixtures. It has been syntax-checked, NOT executed. Additional tests required for concurrent session revocation, lockouts, database privileges, timeout/race behaviour, TLS and recovery. Never copy real secrets into the branch. Public repository source is visible even when a branch is not deployed.

## V4.5 branch note
On v4.5-examination, follow [EXAMINATION.md](EXAMINATION.md) before starting: exam-schema.sql is required and the synthetic local client is served at /exam-demo. The V4.4-only startup steps above are insufficient on this branch. Do not merge into GitHub Pages or expose the staging service publicly.

## V4.6 branch note
Follow [WORKFLOW.md](WORKFLOW.md) and [WORKFLOW_ACCEPTANCE.md](WORKFLOW_ACCEPTANCE.md) after V4.5 setup. Apply both workflow-schema.sql and workflow-functions.sql with approved synthetic roles; local-only CLI and student API. No production staff login, real bank/QR, certificate PDF or public results. Never use real student data. Current GitHub Pages main remains unchanged.

## V4.7 branch note
After V4.6 setup, follow [ACADEMY.md](ACADEMY.md) and [ACADEMY_ACCEPTANCE.md](ACADEMY_ACCEPTANCE.md). Apply academy-schema.sql then academy-functions.sql, use separate mentor roles and disposable academy fixtures. The local synthetic student Academy client is served at /academy-demo. No production release or real learner data; public GitHub Pages main remains unchanged.
