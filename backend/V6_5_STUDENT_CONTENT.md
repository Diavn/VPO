# V6.5 — Student discovery and synthetic content management
Baseline V6.4.1 exact commit 71134ebc5ed2f5b6e66baa5894e464df92c63c7b, Actions run 45670693379 / job 139404871567 completed success, 32 unit tests, recovery edge cases, 35-table restore. Actual private Codespaces browser UAT remains pending.

## Student experience
My VPO shows authenticated student's enrolled rounds (max 100, no topic or other student's records), server-computed availability, and Academy enrolments. Round links prefill the round UUID and course links select only an enrolment returned by authenticated API. Existing explicit login/preflight/start checks remain; no automatic start, no new access rights. Upcoming, closed and awaiting-settlement rounds do not have start links. Existing generic lab links remain for compatibility. No SSO claim.

## CMS
Admin Center can create/edit plain-text NEWS and LIBRARY drafts, publish and withdraw. New content_entries table: 36 tables, 13 migrations. Optimistic revision checks prevent stale conflicting updates; same draft payload/previous revision replay accepted while still draft. Publication is an explicit confirmation; draft data is not returned by public content API. Published entries cannot be edited; withdraw and create new draft instead. Bulletin /bulletin is a private staging preview linked from the staging header. All title/body rendering uses textContent; no raw HTML, uploads or external arbitrary URLs. Existing static GitHub Pages and main unchanged. No separate editorial approver, individual staff attribution, complete revision history or immutable CMS audit; current row stores state/revision/timestamps. Limit 100 latest entries. No real content or personal data.

## Verification
Full prior regression retained. Added A/B round isolation, unauthenticated denial, absence of topic in list, dashboard round/course links, CMS browser draft/edit/publish/withdraw, stale revision denial, draft/published isolation, literal text rendering, account role direct-table denial after restore. New checks configured, not executed at authoring. V6.4.1 remains verified baseline until exact V6.5 commit passes.

## Deferred
Full question bank/versioning, Academy course authoring and mentor UI, media uploads/licensing, editorial roles, real SMTP/MFA, durable hosting and human UAT remain outstanding. No production release or merge.
