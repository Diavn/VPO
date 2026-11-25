# VPO V5.1 — running integration when the chat environment cannot run PostgreSQL

## Preferred: GitHub Actions through a review PR
The V5.0 workflow now supports pull_request targeting v4.7-academy-analytics, only from the same repository and the V5.0 head branch. The PR is for verification; DO NOT merge. main and Pages stay untouched. Open the PR Checks tab or repository Actions, inspect each step. A missing check is not a pass. If Actions is disabled, review Settings > Actions > General and enable only the required GitHub actions if authorized. If approval is required, a repository owner must approve the run. The connector can query PR-triggered runs, not all push-triggered runs. No use of pull_request_target, production secrets, deployments or write-enabled workflow tokens.

## Fallback: Codespaces
Create a NEW Codespace for Diavn/VPO, branch v5.0-integration-gate, using .devcontainer/devcontainer.json. Use the smallest adequate machine, e.g. 2 cores if offered; review usage/billing limits before creation. The devcontainer requests Node 22, Docker-in-Docker and installs a PostgreSQL client. The PostgreSQL SERVER is a disposable postgres:16 container, not a local Mac installation. If the build fails, inspect the Codespaces creation log; configuration is not yet runtime-tested.

In the Codespaces terminal at the repository root:
  git branch --show-current
  node --version
  docker info
  psql --version
  bash -n backend/ci/codespaces-integration.sh
  bash backend/ci/codespaces-integration.sh 2>&1 | tee /tmp/vpo-integration.log

For a reliable exit status when recording logs, first run: set -o pipefail
The script refuses use outside Codespaces, refuses occupied ports, creates a new DB service with a random password, runs the same SQL and HTTP tests, and stops its own disposable container on exit. Do not reuse any real DB. No public port forwarding; do not change visibility. All credentials are generated for synthetic fixtures. Do not upload raw logs without reviewing/redacting tokens and passwords. Share only the failed step, sanitized error, and tested commit. The Codespace should be stopped after use to limit billed compute; delete it only after preserving any needed work/logs. No production deploy.

## Evidence
Environment check 2026-11-25: local node and npm available, no psql/postgres/docker/podman in PATH; npm registry lookup failed EAI_AGAIN. Therefore installing dependencies/database in this chat runtime is not currently feasible. These changes are an execution route, not a passing test result. CI/CodeSpace runs and DB migrations require observed logs. VPO remains NO-GO for production; all V4.0 gates still apply.
