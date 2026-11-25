# VPO V5.7 — Private synthetic staging (2026-11-25)

## Verified baseline
V5.6 commit 0bd521393df9d2aa27fada30f02b55da6fc23e81, Actions run 45579571212/job 139085936659: independently read completed success and log lines SEC01-03 PASS, SEC04-08 PASS, browser smoke PASS, 24 learners / 96 acknowledged drafts / 24 receipts / no mismatched final essays, restore all 32 tables matches and sampled ACL/RLS preserved, npm audit reports zero vulnerabilities. PR #1 unmerged. This is synthetic evidence only.

## Launch (owner-operated Codespaces; disposable)
Open the existing VPO Codespace, ensure no uncommitted edits would be affected, stop any previous test process. Confirm the 8080 forwarded port is Private; do not forward 5432. In repository root:

    git fetch origin
    git switch v5.7-private-staging
    git pull --ff-only
    bash backend/staging/launch.sh private

If local branch does not yet exist: git switch --track origin/v5.7-private-staging.
Type PRIVATE after checking visibility; this is an operator attestation, not automated verification. In Ports, forward 8080 if necessary, keep visibility Private, and open the printed HTTPS Dashboard URL. Do not share terminal output containing generated passwords. A is enrolled; B is not. Only example.test accounts are supported. Enter the printed round UUID in Examination Lab. Academy enrollment is pre-seeded for A. The dashboard shows real synthetic API profile/orders/results (read-only; initially empty orders/results). Separate demo screens may require a fresh login. No staff browser interface, real registration, uploads, external payment or official awards/certificates. Do not enter real data.

If the forwarded proxy changes Host or Origin, the backend intentionally rejects it. Do not disable these checks or change the port to Public. Use VS Code desktop with a private forwarded local port 8080 and launch local mode instead: Ctrl+C, then bash backend/staging/launch.sh local. Open http://localhost:8080/staging on your desktop (exact hostname and port; not 127.0.0.1 or a different port). If browser mode cannot authenticate, record only HTTP status and sanitized error. Neither tunnel path has been end-to-end verified in this turn.

## Design
Fresh uniquely named PostgreSQL 16 Docker container, loopback DB and HTTP, nine migrations from V5.6, separate DB roles, random credentials and CSRF key, two synthetic students, exam & Academy fixtures. Refuse occupied ports. No persistent data expected: Ctrl+C stops own backend and container, removes temporary logs; hard process termination may leave a labeled container; inspect docker ps -a --filter label=vpo.synthetic=staging and stop ONLY the exact disposable instance you own. Never prune globally. Stop Codespace after testing to avoid compute charges. Each restart creates different fake accounts' passwords, round IDs and database. Do not use as durable staging.

## Verification
New workflow vpo-staging-launch.yml runs on this branch and checks syntax, fresh bootstrap, dashboard browser login/reload/logout, A/B distinct profiles, mobile reflow, baseline profile/exam/Academy HTTP tests and container cleanup. It does not rerun the entire V5.6 suite or validate Codespaces TLS proxy. --check only in Actions/Codespaces; installs browser dependencies separately. No public port or domain, deployment to cloud hosting, external credentials or secrets committed. V5.7 is NOT accepted until exact commit CI passes and owner verifies private browser access. V5.8 UAT requires user signoff and tested workflows; no real student records.

Reference: https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace
