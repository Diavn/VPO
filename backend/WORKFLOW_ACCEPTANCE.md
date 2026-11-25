# V4.6 acceptance test register — all NOT RUN
Run only in disposable synthetic staging using independently authenticated DBA/operator/student sessions, after migrations. Record expected/observed results, DB transaction outcome, actor and timestamp; never include credentials, raw certificate tokens or real personal data. Each scenario is blocking for the relevant release.

| ID | Test | Expected |
|---|---|---|
| WF01 | PUBLIC and student runtime try staff routine; staff tries raw table read and runtime routine | Denied by grants |
| WF02 | Examiner A reads own assignment and tries B's assignment | Own essay only, B denied; no identity or other scores |
| WF03 | Examiner locks valid score twice, then tries update/delete | One immutable mark; duplicate and direct change denied |
| WF04 | Moderator proposes with one mark | Rejected; no result |
| WF05 | Two equal or near scores, valid proposal | Exact mean, original marks retained |
| WF06 | Difference >=4; propose without/with adjudication | First rejected; second retains vector and reason |
| WF07 | Moderator attempts approve/publish; publisher before approval | Rejected; no state change |
| WF08 | Independent approval then publication | PROPOSED→APPROVED→PUBLISHED; only owner sees published result |
| WF09 | Student B tries result/appeal/payment object of A | 404; no data change |
| WF10 | A submits report, including fabricated amount or paid state | Valid report REPORTED only; extra fields rejected |
| WF11 | Finance reconcile without matching fixture, wrong amount or reused reference | Rejected; no PAID state |
| WF12 | Exact match, concurrent double reconciliation | One reconciliation; PAID once |
| WF13 | Student tries cert issuance/finance via HTTP | No endpoint |
| WF14 | Issue before publish, for NONE or OPEN/REVIEW_REQUIRED appeal | Rejected |
| WF15 | Issue award token; unknown token and valid token | One token, hash-only at rest; 404 unknown; minimal valid payload |
| WF16 | Open appeal after issuance, then dismiss or review-required | ON_HOLD; dismissed returns VALID_DEMO if no revocation; review-required remains on hold |
| WF17 | Cert officer requests revocation then attempts self-approval | Hold; self-approval denied; independent approval revokes |
| WF18 | Race two examiners, two proposals, appeal vs certificate issuance, duplicate revocation | Constraints and locks preserve integrity; verify no partial transaction |
| WF19 | Audit records after each committed mutation and rejected operation | Committed actions recorded; rejected mutations roll back; no raw token or essay |
| WF20 | CSRF absent/wrong; suspended/revoked account; session races | Denied; investigate concurrent revocation window |
| WF21 | Production readiness gaps | No actual bank data, no official certificate, no production MFA/role scope; NO-GO |

Notes: separate fixture cases for different branches (near scores, disputed scores, appeals, revocation); no resetting by deleting data except destroying disposable database. For wrong-amount reconciliation, DBA creates an artificial mismatched statement line before finance test; keep a separate exact-match fixture. Test with psql role accounts, local HTTP client and CLI; do not simulate role separation using only a single superuser. For each accepted scenario capture sanitized query results and independent sign-off. No assertions of compliance until executed.