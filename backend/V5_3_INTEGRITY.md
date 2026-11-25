# V5.3 — Database integrity & access control
2026-11-25. Synthetic staging only. No merge or deployment. V5.2 baseline was independently verified by Actions run 45574465329 on a817e75e2a907b2b49fd8861ab6231bb5959efa2.
 
Changes:
- Eighth migration integrity.sql adds RLS to student_profiles only; runtime queries require a transaction-local vpo.student_id, provisioning has insert-only policy. Owner bypasses RLS. Trusted shared runtime can set arbitrary context; this does not isolate a stolen runtime credential. No RLS claim for exam, finance, Academy or all 32 tables.
- lock_student_session checks active session and locks session row FOR UPDATE, user and student grant FOR SHARE; protects subsequent profile/attempt/workflow/Academy actions in the same transaction against committed session deletion, suspension or grant revocation. Requests already holding the lock can finish before revocation commits. No staff web auth/MFA. Restoring role/status alone can reactivate old unexpired sessions; operator must invalidate existing sessions before regrant; a full permanent revocation workflow remains open.
- Exam DB triggers validate contiguous revisions from zero, latest_seq and terminal receipt at commit. Terminal attempt cannot reopen or advance; new drafts require active attempt, sequence and supplied save time before deadline. Runtime cannot change/delete existing drafts or receipts. Timestamp is supplied by trusted app; DB owner may bypass triggers. Not tamper-proof.
- CI adds direct DB assertions after all four baseline smokes, including expiry via worker without triggering HTTP lazy settlement, and lock contention with separate owner and runtime connections. DB01–DB10 below are test groups, not a comprehensive authorization matrix. CI must pass on exact new revision; prior baseline is not evidence for the new migration.

| Group | Executable coverage |
|---|---|
| DB01 | Profile no-context denial, scoped reads/update, rollback reset |
| DB02 | Examiner and mentor denied profile/draft/session access; runtime denied staff/mentor routines and direct marks/result/order mutation |
| DB03/04 | Cross-account HTTP read denial; terminal state/draft/receipt restrictions |
| DB05 | Inconsistent latest_seq rejected by deferred constraint; prior concurrent HTTP smokes rerun |
| DB06 | Short synthetic round, acknowledged draft, automatic worker deadline receipt, late save refusal |
| DB07 | Revocation waits for transaction lock; subsequent session requests denied; suspension and deletion |
| DB08/09/10 | Final synthetic workflow counts, reconciliation, certificate, Academy feedback, audit and audit deletion denial |

Open limitations: full object-level isolation under compromised runtime, all tables RLS, DB staff lifecycle and scope, complete negative privilege matrix, user/role lifecycle incl permanent revocation, lock ordering with future admin workflows, DB clock skew, concurrency/load cost of session locks and deferred chain scans, all expiry and recovery cases, audit immutability against privileged operator, production data policy. No security certification. No real data. G0–G5 remain NOT RUN.
