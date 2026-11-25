# V6.4.1 — Account hardening and synthetic delivery
Baseline: exact V6.4 commit 7885821db32dc9d55c1faff6ce2aeadd197ddb8d, Actions run 45668791111 / job 139398256985 completed SUCCESS. Full regression, 35-table restore, synthetic recovery and round replay passed. Actual Codespaces browser UAT remains pending.

## Changes
- Dedicated tests on three newly verified synthetic users: expired reset challenge, changed user epoch (suspend/reactivate), changed grant epoch (revoke/reinstate). Correct original code must fail, no PASSWORD_RESET audit created. Test owner updates only disposable fixture state.
- Synthetic mailbox adapter writes private 0600 temporary file, atomically publishes without overwrite, accepts identical replay and rejects conflict. No network provider; restricted to example.test. Cleanup after successful consumption is best effort, expired message files are purged every minute using file age (DB expiry remains authoritative). Tests cover file mode, replay, conflict, non-synthetic address, invalid identifier and expiry.
- No schema changes: 35 tables, 12 migrations. Full prior regression retained; new branch CI configured. Pending exact-commit execution.

## Real email and staff MFA release gate
Do not enable real email or collect real accounts in Codespaces. Choose a BTC-controlled verified sending domain and provider, approve privacy and retention terms, set up SPF/DKIM/DMARC, keep provider secrets outside repository, implement transactional outbox with encrypted short-lived payloads, idempotent delivery, retry/backoff and bounce handling, abuse quotas and operational monitoring. Test with approved sandbox recipients before launch.
For staff identity, prefer managed identity with individual accounts, role assignment/revocation, phishing-resistant WebAuthn/passkey MFA where feasible, audited recovery and break-glass procedure; never use shared Admin credentials in production. Review cross-role origin isolation, session revocation, emergency exam continuity, and consent for minors before release.

## Known limits
File delivery and database challenge creation are not one transaction; crash/failure between them can leave challenge without a message until re-request cooldown. File age purge is not durable outbox or guaranteed secure deletion, and abandoned temporary files on hard crash may remain until disposable launcher cleanup. Generic response does not guarantee timing indistinguishability. No real SMTP, MFA or production configuration. No merge. V6.4 remains last verified baseline until this exact commit passes CI. No changes to main.
