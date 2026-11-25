# VPO V4.5 — synthetic examination lab
Status: local staging source, not production; branch derived from v4.4-secure-backend, not merged to main. No real exams, student data, payments, public signup, or staff access. No secrets or confidential topics in this repository.

## Run only after V4.4 setup
1. Read backend/README.md; prepare a fresh local PostgreSQL database, migration owner and restricted roles. Run schema.sql, grants.sql, then exam-schema.sql. These migrations are additive to the reduced staging schema, not the full V3.4 design. Do not apply to the existing VPO database.
2. Provision two distinct synthetic accounts A and B with @example.test addresses through the V4.4 tool. As migration owner, use psql -v demo_email=learner@example.test -f exam-fixture.sql (with a private DBA connection). It creates a new 2-hour open window and a 30-minute synthetic attempt duration. Copy returned round UUID. Only A is enrolled; B is an unauthorized fixture. Do not use actual students.
3. Install/review dependencies and lockfile, configure VPO_MODE=synthetic-staging and VPO_ORIGIN=http://localhost:8080 per V4.4, switch to runtime DB role, npm start. Visit http://localhost:8080/exam-demo on the same machine. Server requires exact host/origin and binds loopback. No GitHub Pages frontend connection. Login with A and round UUID. Check permission, start, type fake essay, save, submit, retrieve receipt. Refresh requires login/recovery; no browser persistence.
4. For disposable automated HTTP smoke, create a NEW unused fixture round for A; set VPO_TEST_ROUND and VPO_TEST_A_EMAIL/PASSWORD and VPO_TEST_B_EMAIL/PASSWORD privately. Run node tests/exam-integration.cjs. It submits A's attempt irreversibly. Do not run against an already-used fixture. It tests concurrent starts, conflicting saves, duplicate operations, CSRF, cross-account access and receipt replay, but not deadline worker.

## API map (staging subset)
GET /rounds/{id}/preflight: eligibility from explicit DBA enrolment and schedule, no topic.
POST /rounds/{id}/attempts: one attempt per round and user; repeat returns existing.
GET /attempts/{id}: state, latest revision, server time/deadline.
GET /attempts/{id}/topics: one synthetic frozen topic, only while active.
GET /attempts/{id}/draft: latest server-confirmed revision, including after closure.
PUT /attempts/{id}/draft: expected_seq, op_id UUID, body; max 40,000 UTF-8 bytes and 65,536 request bytes; max 2,000 revisions; 600 mutations per user/15 min.
POST /attempts/{id}/submit: expected_seq, one receipt per attempt, retries return same receipt.
GET /attempts/{id}/receipt: immutable receipt reference to exact saved revision.
POST /attempts/{id}/events: event_id UUID and HIDDEN/VISIBLE/RECONNECTED; max 120 distinct events, no device, URL, clipboard, camera or personal content. Client events are best effort, not evidence of cheating.
All writes require exact origin, authenticated student, CSRF; attempt routes scope ownership. No actual eligibility/payment integration, accommodations, topic selection, upload or staff adjudication.

## Data integrity and time
PostgreSQL row lock serializes writes on each attempt. Server reads clock after lock; this is the cutoff rule for the prototype (millisecond application timestamp precision). A request waiting on a lock until cutoff may be refused. Client countdown is a display estimate, not authority. A save ACK is emitted only after transaction commit; lost ACK retries retain same op_id; changed content with same op_id or stale sequence is rejected. Older replay never replaces newer text. Runtime role cannot update/delete draft revisions or receipts; migration owner can, so this is not tamper-proof storage. No lost-ACK durability guarantee until failover/restore tested. Worker every 5 seconds (max 20 attempts per sweep) plus lazy settlement on access closes expired attempts with final acknowledged revision, even if no browser submit. During outage worker cannot run; it settles after recovery. Empty seq 0 is a valid snapshot. Need test queue capacity, clock sync, DB failover and cutoffs. A last unsaved offline text is NOT guaranteed submitted; browser memory disappears on refresh/close. Client event timestamps are not relied on and no automatic misconduct decision is implemented.

## Verification record (2026-11-25)
Node.js 22.16.0: 7/7 exam-policy tests passed on exact copies with Git blob SHA 5ac30be60fbe7a013d3e10e46fdf9ebed68f29af and 9b7f2765d712bc4fc2ae059b56e845d6bda5ac17. These are validation/decision functions, not database transactions. JavaScript syntax checked for new modules/client and server integration; HTTP smoke supplied but NOT run. No PostgreSQL executable available here; migration, DB grants, lock behavior, client browser, access isolation, expiry worker, network recovery and load tests NOT run. V4.4 integration remains outstanding. Do not claim production readiness.

## Release gate
Complete V4.4 auth/MFA and role separation; reconcile full V3.4 data/API contract, formal eligibility, privacy/guardian, retention/deletion, incident accommodations, appeals, official topic selection/release and integrity, controlled audit, rate limiting, RLS/DB permissions, TLS and private hosting; run actual integration, timed boundary, failure/restart, concurrency, network drop, multi-tab, accessibility, load and independent pentest. No genuine competition before G0–G4 approval. Browser cannot prevent all app switching or secondary devices; no event-only sanctions.
