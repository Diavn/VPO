# VPO V5.4 — Browser, responsive and accessibility smoke (2026-11-25)

## Verified baseline
V5.3 commit e5829b886f5cc60cec0e704cac7304b4bc06cdbc, Actions run 45577830943/job 139080099344: completed success. Log independently read: 29 Node tests passed, zero failed; DB01, DB02, DB03/04, DB05/06, DB07, DB08/09/10 passed; npm audit reported zero vulnerabilities at that run. Scope is synthetic smoke; not full database isolation or production acceptance.

## New execution path
Playwright Chromium (1.56.1) and axe-core (4.10.3), pinned direct dev dependencies; transitive lockfile still outstanding. CI installs Chromium and system dependencies, then runs browser-integration.cjs after existing database/integration tests. Public HTML served at localhost port 8090 under /VPO/ from branch files, not the live domain. Exam/Academy use the synthetic backend at localhost:8080. Disposable data only; no external navigation or real students. Browser smoke enabled by VPO_BROWSER_TESTS=yes. Existing Codespaces script does not enable it by default; to opt in inside the disposable Codespace, install dependencies and Chromium first with cd backend && npm install --ignore-scripts && npx --no-install playwright install --with-deps chromium, then cd .. and VPO_BROWSER_TESTS=yes bash backend/ci/codespaces-integration.sh. Check billing and stop Codespace after use.

| ID | Browser checks planned |
|---|---|
| BR01 | 11 public pages x VI/EN x widths 320, 390, 768, 1440 = 88 loads; exactly one visible h1 and main, language attribute, horizontal overflow |
| BR02 | Keyboard skip link and FAQ expansion |
| BR03 | Accent-insensitive search, language switch and navigation persistence |
| BR04 | Archive and results year filter |
| BR05 | Practice essay count, timer start, TXT download, clear |
| BR06 | Portal sample completion, review, payment reporting, reset |
| BR07 | Real local exam login, preflight, draft save, receipt, editor lock |
| BR08 | Local Academy login, portfolio, feedback, refresh, logout |
| BR09 | Automated axe WCAG 2.0/2.1 A/AA tagged rules at public widths 390/1440 and local mobile states; serious/critical findings fail job |
| BR10 | Page JS errors, missing public resources and document-wide horizontal overflow fail job |

CSS changes mitigate intrinsic grid sizing, long text and mobile form overflow, without changing brand tokens. Browser script logs only findings and synthetic test status, no screenshot/credentials. No test result recorded for V5.4 until exact commit CI logs observed. Axe does not prove WCAG compliance; manual keyboard/focus order, 200–400% zoom, screen readers, real iOS Safari/Android, Firefox/WebKit, Vietnamese/English editorial completeness and mobile touch target checks remain required. No production release. Keep PR #1 open; main unchanged.