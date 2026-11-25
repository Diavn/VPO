# VPO V5.6 — Security hardening and negative regression
2026-11-25. Synthetic staging only. No deployment, production data or merge. V5.5 exact commit 6d2a9bb1c373713d77e44df5f819afa5b4c8bdcc, Actions run 45578913035/job 139083720088 verified success: 24 simultaneous users, 96 saved revisions, 24 unique receipts, zero final essay mismatches; p95 save 34 ms, submit 28 ms; same-cluster logical restore matches 32 tables and sampled ACL/RLS; npm audit production dependencies reported zero vulnerabilities. Not production capacity or RTO/RPO evidence.

## Changes and verification boundary
Ninth migration security-hardening.sql introduces monotonic user and grant epochs. Session stores both epochs; changes to account status, email, password hash or grant revocation invalidate previously issued sessions permanently. Login issuance compares versions observed before password verification while locking relevant rows. Direct runtime INSERT into sessions revoked; issuance routine is restricted to runtime but remains a trusted-app interface, not a defense against compromised runtime credentials. Grant deletion blocked in this synthetic slice; use revoked_at, preserve history. Migration intentionally invalidates existing sessions; DO NOT run on real data. Existing row-lock semantics permit in-flight requests holding locks to finish before revocation commits. Actual concurrent password/role changes during hashing need further stress testing.
HTTP body parser enforces UTF-8 JSON media type, rejects unsupported encoding, malformed UTF-8/JSON and oversized Content-Length, bounds streamed body. Rejects oversized/invalid request paths; local HTML asset responses gain Permissions-Policy, CORP and conditional HSTS. Chunked overrun may close connection; duplicate JSON keys not rejected; no WAF or global request budget. No real HTTPS tested.
 
| Group | New executable smoke scope |
|---|---|
| SEC01 | Exact Origin and CSRF, disallowed profile fields |
| SEC02 | Malformed JSON/UTF-8, unsupported encoding/media type, oversized body |
| SEC03 | Sample response security headers, local cookie attributes |
| SEC04 | Revoked and restored grant never reactivates old cookie |
| SEC05 | Session issuance with stale authorization epoch refused |
| SEC06 | Suspended/reactivated account and password hash change invalidate old cookie |
| SEC07 | Direct runtime session insertion and grant deletion denied |
| SEC08 | New login works; logout invalidates cookie |
Run through disposable-integration.sh after existing database/browser tests and before load/restore. Status NOT VERIFIED until exact head CI completes. Prior V5.5 pass does not establish V5.6 pass.

## Residual production blockers
P0: staff MFA/OIDC, verified registration/guardian and privacy/legal workflow, private evidence storage, scoped authorization across season/round, compromised-runtime threat boundary, operator lifecycle/least privilege; secret management/TLS/proxy configuration, abuse/rate limiting, security observability; official exam policy and N/1.5N load with real network, restore across independent infrastructure, signed release gates. P0: dependency lockfile/reproducible build, SBOM, container and dev dependency checks, independent audit and applicable ASVS mapping. P1: manual accessibility/device tests, approved assessment rubric, content/source verification, external integrations, full incident exercise. This is internal hardening, NOT independent penetration testing or security certification. No G0–G5 signed; production NO-GO.
