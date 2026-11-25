# V4.7 acceptance register — NOT RUN
Use fresh disposable synthetic fixtures only. Record test evidence, actual results, timestamps and reviewer sign-off. Never include secrets or real student data.

| ID | Scenario | Expected |
|---|---|---|
| AC01 | Run migrations with migration owner; runtime and mentor attempt direct table access | Schema succeeds; no direct table privileges |
| AC02 | Anonymous reads portfolio | 401 |
| AC03 | B reads or writes A's enrolment | 404; no data change |
| AC04 | A views course | Six lessons, correct version and rubric |
| AC05 | Duplicate lesson completion | One completion; self-report only |
| AC06 | Completion without assessment | No assessed score; null not zero |
| AC07 | Revision or transfer before predecessor feedback | Locked prompt and rejected submission |
| AC08 | Submit baseline, retry identical op_id | One immutable ID |
| AC09 | Change payload with same op_id or second same-stage submission | Conflict; no overwrite |
| AC10 | Concurrent duplicate submissions | One canonical record; verify locks/constraints |
| AC11 | Other mentor attempts read and feedback | Denied |
| AC12 | Assigned mentor reads submission | Only assigned essay, prompt, condition; no profile |
| AC13 | Feedback missing reason/action or outside 0–4 | Rejected |
| AC14 | Duplicate feedback | One immutable record |
| AC15 | Feedback unlocks revision; revision note required | Correct ordering |
| AC16 | Revision assessed, then transfer opens | Correct ordering; no claim of secure prompt |
| AC17 | Assessed 10,15,12 under stated conditions | Revision diff 5; declared-independent diff 2 |
| AC18 | Transfer declares other support | Transfer score present; declared-independent diff null |
| AC19 | Missing CSRF, suspended account, concurrent revocation | Denied; race test required |
| AC20 | Refresh/offline/lost ACK/conflict on browser | Accurate status, no silent loss claim; test usability |
| AC21 | Accessibility, mobile, load, database restore and threat model | Evidence required; no production approval |
| AC22 | Course quality and scoring reliability pilot | Requires ethics/safeguards, approved rubric, independent scoring and comparable tasks; no validated competence claim |

Run tests/academy-integration.cjs for a subset of AC02–09 and AC11–17. Remaining checks require separate role/DB fixtures and browser/infrastructure testing. No actual students or official assessment.
