# VPO V5.8 — Mock examination and human acceptance protocol
2026-11-25 | Synthetic only; not official VPO. No personal data, real fees, official results or production secrets.

## Baseline evidence
V5.7 commit 6c2c3a4383ff318fc6b17b5257dc833eb9a1c772, run 45609059694, job 139187492505: completed success; all 9 migrations, fresh container, dashboard login A/B and distinct profiles, reload/logout/mobile reflow, profile/exam/Academy integration and removal of container passed. Codespaces HTTPS/owner browser acceptance remains unverified. V5.6 security, load and restore run 45579571212 already verified.

## Automatic mock (fresh disposable stack)
CI uses bash backend/staging/launch.sh --check. It executes V5.7 dashboard browser and profile tests, manual submission and replay, then seeds marking case and artificial fee for the exact submitted attempt of the first round. Existing workflow test executes independent DB identities for two examiners, moderation, approval, publication, finance, appeal and certificate issue/revocation. Academy smoke follows. New deadline test enrolls B only in a separate short-lived round, saves a revision, observes the database without HTTP requests until worker has finalized it, then checks receipt replay and rejection of late writes. No official scoring rule: fixture uses 10/20 and 20/20, explicit adjudication to 15/20 and mock award FIRST. These numbers are software assertions, not evidence of marking quality or actual awards. CI is not human UAT. Gate status pending until exact commit logs are checked.

## Human rehearsal (owner-operated; private)
Use a fresh Codespace session, stop prior test process and check Git working tree first.
    git fetch origin
    git switch v5.8-mock-acceptance
    git pull --ff-only
    bash backend/staging/launch.sh private
If no local branch exists, use git switch --track origin/v5.8-mock-acceptance. Confirm private port 8080, never forward 5432. Read V5_7_PRIVATE_STAGING.md for HTTPS and local fallback. Keep launcher alive; it presents an optional operator prompt. Use printed synthetic A credentials in dashboard and round UUID in Exam Lab. Record visible save acknowledgement and receipt, not essay text or password. Test B in a separate browser context (B not enrolled in this manual fixture).

After A submits, type seed at VPO mock> prompt. It creates one case, assignments and artificial fee/statement; records UUIDs in terminal. Do not seed twice. For every staff command enter the JSON payload on the next line; {} for no payload. UUID placeholders must be replaced with actual IDs from the synthetic terminal.

| Command | Payload | Expected |
|---|---|---|
| staff ci_exam_a queue | {} | assignment X |
| staff ci_exam_b queue | {} | assignment Y |
| staff ci_exam_a read_assigned Y | {} | denied |
| staff ci_exam_a read_assigned X | {} | assigned essay, no direct student identity fields |
| staff ci_exam_a lock_mark X | {"scores":[2,2,2,2,2],"reason":"Mock rationale A"} | locked |
| staff ci_moderator propose CASE | {"award":"FIRST","reason":"Mock"} | denied before second mark |
| staff ci_exam_b lock_mark Y | {"scores":[4,4,4,4,4],"reason":"Mock rationale B"} | locked |
| staff ci_moderator propose CASE | {"award":"FIRST","reason":"Mock"} | denied without adjudication |
| staff ci_moderator propose CASE | {"award":"FIRST","reason":"Mock adjudication","adjudicated_scores":[3,3,3,3,3]} | proposed 15/20 |
| staff ci_publisher publish CASE | {} | denied before approval |
| staff ci_approver approve CASE | {} | approved; A refresh still no published result |
| staff ci_publisher publish CASE | {} | published; A refresh shows 15/20, B sees no result |
| staff ci_cert cert_issue CASE | {} | mock token; never publish it |

Operator console does not implement separate human logins; same owner simulates roles using distinct DB credentials. It does not implement staff web UI. Payment reporting, appeal and certificate lifecycle are exercised by automated integration but do not have end-user interactive acceptance screens in this slice. Never represent them as human-accepted. Essay anonymity is limited; avoid names in sample essays. No AI detection or automatic misconduct judgment. Manual exam 30 minutes; deadline worker coverage uses separate automated round with shortened closing time.

## Acceptance record — all NOT RUN by humans at authoring
| ID | Human observation | Evidence criterion | Blocking? |
|---|---|---|---|
| U01 | Private launch | correct HTTPS/local URL, 8080 Private, no DB forwarding | yes |
| U02 | Student A profile | synthetic ID, no other student data | yes |
| U03 | B eligibility denied | no topic/attempt for A's round | yes |
| U04 | Save/reload/reconnect | last acknowledged text preserved, unsaved text clearly distinguished | yes |
| U05 | Submit/replay | same receipt; no late revisions | yes |
| U06 | Assignment separation | wrong assignment denied; marks locked | yes |
| U07 | Moderation | two independent rationales, explicit adjudication | yes |
| U08 | Approval/publication | unpublished result hidden; own result only after publication | yes |
| U09 | Academy | separate practice tasks and independent-declared transfer | yes |
| U10 | Recovery and clean stop | stop removes only disposable instance; no real data | yes |
| U11 | Staff web UX, finance/appeal UI, certificate delivery | not implemented; defer to explicit scope decision | yes for production |
| U12 | Timed worker and real-network test | CI deadline assertion plus manual end-of-round rehearsal | yes |

For each observed case record run date/time/timezone, branch SHA, tester ROLE (not personal details), expected, actual, PASS/FAIL/BLOCKED/NOT RUN, evidence path with redaction, severity P0/P1/P2, issue number, retest. Separate operators must review role separation; one owner cannot sign as independent examiner/approver. Record signed approval only when actual responsible officers approve. Stop on any unauthorized disclosure, lost acknowledged save, duplicate receipt, premature publication or data integrity mismatch. Do not merge any PR or use real students. Production NO-GO until formal governance and operational gates, legal/privacy, staff auth/MFA, load target, backup/restore across independent hosts and independent security review are addressed. No automatically computed final acceptance.
