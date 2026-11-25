# VPO V5.0 Integration Gate — 2026-11-25
Decision: NO-GO for production, CONTINUE synthetic integration only. No merge to main, no changes to GitHub Pages or existing VPO domain. Branch v5.0-integration-gate descends from v4.7-academy-analytics.

## CI execution
Review .github/workflows/vpo-integration.yml and backend/ci/disposable-integration.sh. The workflow triggers on pushes to the V5.0 branch, using a GitHub-hosted runner, ephemeral PostgreSQL 16 service, Node 22, read-only repository permission and checkout without persisted credentials. The database admin credential in workflow is a deliberately disposable fixture, not a real password. Each run generates separate passwords for 14 restricted identities and two synthetic students. It refuses a non-CI run or an existing vpo_stage schema; no production DB connections. The migration owner is not the app runtime role. The test sequence applies all seven SQL files, provisions A/B, runs profile/auth, exam, assessment/finance/certificate and Academy integration smoke scripts. It also runs unit/syntax checks and an npm high/critical vulnerability check. Dependency installation is not yet locked; package-lock and audited image/action pin review remain required. CI passing would establish a limited integration baseline only. The deadline worker, clock/race edge cases, actual load, restore, browser accessibility, independent penetration testing and full ASVS mapping remain outside CI.
 
View Actions at https://github.com/Diavn/VPO/actions?query=branch%3Av5.0-integration-gate . GitHub API returned no combined statuses and no PR-triggered workflow runs for the initial workflow commit; these endpoints do not establish whether a push-triggered run started. No actual CI completion verified. If no run appears, verify Actions settings and push a reviewed commit on this branch via authorized GitHub access. workflow_dispatch may require the workflow on the default branch; do not change main solely to force a manual trigger. Do not deploy or merge while checks are absent or failing.

## V5.0 changes
- Real disposable integration harness and workflow integration smoke: two independent examiners, moderation/approval/publish, unauthorized read/write denial, report vs reconciliation, hold/revoke certificate, and other inherited tests.
- Health/startup now require vpo_runtime as session/current user and all 32 expected relations plus six routine signatures. This detects missing objects, not correct permissions, full schema compatibility or security.
- No staff web access, payment provider, real certificate, real registration, production environment or legacy data migration. No new public features.

## Evidence register (current verification)
| Evidence | State |
|---|---|
| Exact Git blob matching local Academy helper/test dependencies (67bf5f453623131956b3a53f47130c1675519b94; 5c54fffb1cdd5c4e3fb87b8b7423a794e4a00881; 128ab9d906ec19bc3f4d8b25b0a10a43353cadeb; 5ac30be60fbe7a013d3e10e46fdf9ebed68f29af) | 9/9 rerun PASS Node 22.16.0 |
| V4.4–V4.7 other prior unit test records | Previously reported; not rerun as a combined suite here |
| Workflow and new CJS source | Committed; JS syntax checked |
| PostgreSQL and HTTP integration | NOT VERIFIED / no local PostgreSQL or Docker |
| Dependency audit, browser, load, restore, pen test | NOT RUN |
| G0–G5 | NOT RUN, no signed acceptance |

## Blocking risk register (engineering review, not measured exploit severity)
| ID | Priority | Blocker | Evidence needed |
|---|---|---|---|
| INT01 | P0 | CI result and migrations not verified; SQL/HTTP failures possible | Green exact commit, sanitized logs, replay on clean DB |
| INT02 | P0 | Direct compromised runtime DB identity can supply arbitrary user UUID; no complete RLS | Threat model, separate least-privilege boundaries and negative tests |
| INT03 | P0 | No production staff MFA, role lifecycle or season/round scoping; CLI only | Staff identity/RBAC, recertification, revocation races |
| INT04 | P0 | No approved real registration, private evidence, child/guardian data or retention workflow | Privacy review, consent/legal basis, storage/scan/deletion/restore |
| INT05 | P0 | No verified exam policy, accommodations, secure topic operations, sustained failover or load | BTC approval, server cutoffs, multi-tab/network, N/1.5N, recovery |
| INT06 | P0 | No real bank feed/reversals/waivers/refunds or official selection; result amendments absent | Approved policy, tested reconciliation and versioned appeals |
| INT07 | P0 | No full ASVS L2 applicability mapping or independent security audit | Signed test evidence; no open High/Critical findings |
| INT08 | P0 | No inventory/migration of existing website/data, authority, hosting, DNS or budget | G0 signed decisions with BTC and technical owner |
| INT09 | P1 | No full browser/accessibility tests; public and local clients separate | Browser/device/UAT evidence and approved content |
| INT10 | P1 | Academy single mentor and self-declared conditions, no validated growth | Pilot, rubric reliability and assessment validity |
| INT11 | P0 | Dependency lockfile, SBOM, dependency/container scan and supply-chain review outstanding | Reproducible build, reviewed pins, scan logs |
| INT12 | P0 | No operational observability, incident response, backup restore or rollback test | Staging restore/drill and sign-off |

## Canonical V4.0 release gates (source: 05_master_registers/03_release_gates_master.csv in V4.0 master package)
| Gate | Evidence / owner | Status |
|---|---|---|
| G0 | Inventory, authority, N, approved scope and policy / BTC | NOT RUN |
| G1 | Secure baseline, source/infra ownership, privacy assessment / Tech Lead + Privacy | NOT RUN |
| G2 | Staging implementation, API/DB and Q/S/O evidence / QA + Security | NOT RUN |
| G3 | No open High/Critical, applicable ASVS L2, mock/load/restore, legal approval / BTC + QA + Security + Tech Lead | NOT RUN |
| G4 | Production smoke, monitoring, rollback readiness, signed launch / BTC + SRE | NOT RUN |
| G5 | Post-exam integrity, grading approval, publication verification, lessons / BTC + Academic Lead | NOT RUN |

All 18 V4.0 decision rows remain unapproved in source; no authority to sign for BTC. Preserve the canonical 140 requirement and 104 acceptance registers, without equating this CI smoke with fulfillment. Next: confirm CI logs, fix failures on this branch, then G0/G1 owner-approved decisions and G2 staging acceptance. No real student data or official exam before G0–G4 are signed.