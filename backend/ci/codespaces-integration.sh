#!/usr/bin/env bash
# Run only inside the VPO Codespace, not on a host with real data.
set -euo pipefail
[[ "${CODESPACES:-}" == true ]] || { echo "Codespaces only"; exit 1; }
cd "$(dirname "$0")/.."
for cmd in docker psql node npm openssl curl; do command -v "$cmd" >/dev/null || { echo "Missing $cmd"; exit 1; }; done
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]] || { echo "Node 22 required"; exit 1; }
# Refuse if an existing PostgreSQL listener/container occupies the test port.
if (echo >/dev/tcp/127.0.0.1/5432) 2>/dev/null; then echo "Port 5432 already in use. Refusing to touch existing database."; exit 1; fi
if (echo >/dev/tcp/127.0.0.1/8080) 2>/dev/null; then echo "Port 8080 already in use. Stop the existing test service first."; exit 1; fi
name="vpo-ci-$(openssl rand -hex 6)"
export PGPASSWORD="$(openssl rand -hex 24)" VPO_CI_DISPOSABLE=yes
docker run -d --rm --name "$name" -e POSTGRES_DB=vpo_ci -e POSTGRES_PASSWORD="$PGPASSWORD" -p 127.0.0.1:5432:5432 postgres:16 >/dev/null
trap 'docker stop "$name" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 60); do
 if PGPASSWORD="$PGPASSWORD" psql -XAt -h 127.0.0.1 -U postgres -d vpo_ci -c 'SELECT 1' >/dev/null 2>&1; then break; fi
 sleep 1
done
PGPASSWORD="$PGPASSWORD" psql -XAt -h 127.0.0.1 -U postgres -d vpo_ci -c 'SELECT 1' >/dev/null
npm install --ignore-scripts --no-audit --no-fund
npm test
node ../tests/portal-demo.test.cjs
bash ci/disposable-integration.sh
npm audit --omit=dev --audit-level=high
echo "Codespaces synthetic smoke complete. Not production acceptance."