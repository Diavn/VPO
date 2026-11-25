# VPO V6.2 — Unified synthetic portal
Baseline: exact commit 6d26af995554eec6e808591738924782d39879f2, Actions run 45651409646/job 139336707769 passed full regression, 31 unit tests, 88 public page loads, 24-user load, recovery of all 34 tables, sampled ACL/RLS, zero reported runtime npm vulnerabilities. Actual Codespaces login not accepted.

## Single entry
Gateway listens on loopback 8091. Public preview ten information pages under /VPO/, My VPO redirects to /staging (not the previous static demo portal). Register /register, admin /admin, exam /exam-demo, academy /academy-demo. Original public source files and main unchanged. Staff desk remains separate operator-only local 8081; no SSO, no real mail. Separate student session and admin bearer authentication remain; same origin does not provide browser isolation if an XSS flaw is introduced. Gateway uses an explicit static/API allowlist, fixed upstreams 8080 and 8082, validates external Host/Origin before translating to the configured upstream origin, filters cookies and authorization by service, bounds request/response size. Does not trust X-Forwarded-* headers or accept missing/null/foreign origin. No database credential in gateway process. Gateway is not a production reverse proxy; no real data.

## Operation
Complete and record current mock UAT before stopping; Ctrl+C deletes disposable data. In a clean working tree:
    git fetch origin
    git switch v6.2-unified-portal
    git pull --ff-only
    bash backend/staging/launch.sh private
If needed git switch --track origin/v6.2-unified-portal. Remove existing forwarded ports 8080 and 8082 in Codespaces Ports. Forward only 8091 with Private visibility (do not forward 5432). Operator attestation, not automatically enforced by gateway. Open printed unified URL from Ports; username admin and fresh hidden password prompt. For reliable alternative use VS Code Desktop local private forwarding 8091 and launch.sh local, then http://localhost:8091/. Staff desk local 8081 only if required. Registration OTP still synthetic via mail UUID at VPO mock> prompt. diagnose prints service readiness and sanitized rejected Origin/Host/route logs. If actual Codespaces still rejects Origin, collect diagnose output; do not turn off security checks. Real HTTPS proxy acceptance and human UAT remain pending.

## Verification
V6.2 CI runs the complete V6.1.6 master regression plus browser workflow on 8091 (public navigation, new synthetic registration through OTP, student/admin sessions and admin search/logout, denied paths/origin), and simulated private proxy headers at gateway. No real proxy access or real account issuance. CI pending at authoring; production gate remains closed. All source changes on dedicated branch, no merge.
