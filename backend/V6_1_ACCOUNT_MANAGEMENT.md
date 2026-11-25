# VPO V6.1 — Account administration and email-verification prototype
25 November 2026. Synthetic staging only. V6.0 CI run 45612624172 completed success. New V6.1 CI pending at authoring. No real mail sent, no real accounts, no production release.

## Start
Finish current mock tests and save sanitized evidence before stopping: Ctrl+C removes disposable DB. Check clean Git tree.
    git fetch origin
    git switch v6.1-account-management
    git pull --ff-only
    bash backend/staging/launch.sh private
If branch does not exist locally: git switch --track origin/v6.1-account-management.
Keep ports 8080 and 8082 Private; never forward 5432. Type PRIVATE after checking. Enter a fresh admin password (15–256 UTF-8 bytes) twice at the hidden prompt. Do not reuse a password previously disclosed anywhere. Username admin. Password is hashed with existing scrypt policy; only hash passed to dedicated process. No default password. On startup terminal prints Admin and Registration URLs. If Codespaces proxy rewrites Host/Origin, use local mode and private VS Code desktop port forwarding. No proxy bypass.
    
## Admin
Visit printed /admin on port 8082, authenticate as admin. List/search up to 200 matching latest accounts; verified timestamp visible (existing seeded A/B not verified). Invite by synthetic email; account created only after verification. Suspend/reactivate or soft delete. Delete marks SUSPENDED and deleted_at, cannot reactivate; active attempts block deletion. Epoch trigger invalidates previous student sessions upon suspension; protects assessment records. Admin cannot create other admins or change user passwords. Admin token in browser memory only, hash held in service memory, 30-minute maximum and one active admin login, logout revokes. Not real staff identity/MFA. Same-origin exact Host/Origin required; no cookies shared with student service. Admin credential hash not persisted across staging restarts. Separate vpo_accounts DB role only executes restricted functions; student backend does not receive admin credential. Audit records action/target/time; actor is single synthetic admin by design (not independent human attribution).

## Registration
Open /register, enter a fresh @example.test email. Click send code, copy request UUID. In launcher terminal type:
    mail <challenge UUID>
This displays a synthetic message (recipient, challenge UUID, 8-digit code). Enter code and new student password on register page. No student account until correct code accepted. Code 10-minute TTL, single use, max five wrong attempts, 60-second resend cooldown, max three requests/email/15 minutes in process; global and verification rate limits. DB stores keyed MAC rather than raw code. The simulated email file is plaintext in mode-0700 temporary directory (file mode 0600), not accessible via HTTP, removed on consumption or stack cleanup. Do not post codes, passwords or private URLs. A fresh account can login on port 8080 /staging, but cannot take a round until separately enrolled. No real consent, document uploads or public enrollment.

## Real email is NOT enabled
The current security contract intentionally accepts only example.test and synthetic mode. A real email service requires an approved transactional mail provider, verified sending domain, SPF/DKIM/DMARC, provider secret outside Git, durable transactional outbox with retries and delivery/bounce handling, abuse monitoring, and data protection/guardian policies. Send email only after these are approved and staged on a restricted real-address test cohort. Never use admin password as SMTP/API credential. Real email verification is proof of control of an inbox, not proof of identity, age, guardian relationship or exam eligibility. Real registration remains NO-GO. Real account deletion/anonymization/retention must be approved; soft deletion is not erasure. This prototype has no persistent deployment, no password reset, no admin MFA, no paging beyond 200, no real registration or verified staff identity.

## Tests
V6.1 CI adds account lifecycle tests to existing V6.0 suite: unauthenticated admin denied, foreign origin denied, real email denied, fake mail generated, no preverification login, incorrect/replayed code denied, successful student login, admin browser search, suspended session invalidation, reactivation, irreversible soft delete, admin invite and logout. Only report PASS after checking CI logs for exact commit. Human private proxy access, full browser registration flow and independent security/privacy acceptance remain unverified.
