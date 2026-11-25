# V6.6.1 — Operational finance (synthetic)
Verified V6.6 base 657dcec259516544379d049033b0258b3d59ed95, CI run 45686919943/job 139461916272 SUCCESS. Public GitHub Pages restored separately, run 45689035263 SUCCESS. No production backend.

## Scope
An authenticated synthetic admin creates a fee order only for an active, verified student enrolled in the chosen round. Integer 1–1000000 fictional units, no currency. Existing order of same amount returns EXISTS and original id; conflicting amount is refused. Order starts UNPAID; no admin mutation of payment status, bank evidence, amount, refund or waiver. Audit in same transaction records order id/user/round. Finance summary shows exact global counts and sums across existing order states, and at most 100 round aggregates; no personal details in aggregates. Counts include all recorded orders, not only currently active accounts. Fee does not gate exam access. Independent finance reconciliation unchanged. The synthetic owner fixture reuses existing fee order amount instead of inserting a duplicate, and creates independent fictional statement evidence only if none exists; no real bank ingestion.

## Verification
37 tables, 15 migrations. Tests cover UI order creation, amount validation, state injection denial, unverified account denial, replay, conflict, exact aggregate delta, audit, student visibility. Prior independent reconciliation and appeal/certificate tests remain. One additional 61-second test group separation respects unchanged account request limit. Restore checks restricted grants. CI pending; V6.6 remains last verified baseline. Dedicated test of preexisting-order fixture reuse still pending. No real data or money, no production or merge.

## Deferred
Printable PDF and QR demo, actual signed certificates, export reports, individual finance staff identities/MFA, real fee policy, refunds and banking integration, durable hosting, actual Codespaces UAT. Do not publish mock certificates as official. Public main unchanged.
