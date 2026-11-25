#!/usr/bin/env bash
# Fresh synthetic DB only. No production connections. Do not source this file.
set +x
set -euo pipefail
umask 077
mode="${1:-local}"
case "$mode" in
 local|private) [[ "${CODESPACES:-}" == true && -t 0 && -t 1 ]] || { echo 'Interactive Codespace only'; exit 1; };;
 --check) [[ "${GITHUB_ACTIONS:-}" == true || "${CODESPACES:-}" == true ]] || exit 1;;
 *) echo 'Usage: bash backend/staging/launch.sh [local|private|--check]'; exit 1;;
esac
cd "$(dirname "$0")/.."
for cmd in docker psql node npm openssl curl; do command -v "$cmd" >/dev/null || { echo "Missing $cmd"; exit 1; }; done
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]] || { echo 'Node 22 required'; exit 1; }
for port in 5432 8080; do
 if (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then echo "Port $port occupied; refusing to touch existing services"; exit 1; fi
done
export VPO_MODE=synthetic-staging VPO_PORT=8080 VPO_ORIGIN=http://localhost:8080
if [[ "$mode" != --check ]]; then
 echo 'Use a Private port only. Do not forward PostgreSQL (5432).'
 read -r -p 'Type PRIVATE to confirm: ' confirmation
 [[ "$confirmation" == PRIVATE ]] || exit 1
fi
if [[ "$mode" == private ]]; then
 [[ "${CODESPACE_NAME:-}" =~ ^[a-zA-Z0-9-]+$ && "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'Cannot derive exact Codespaces origin'; exit 1; }
 export VPO_ORIGIN="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi
export VPO_CSRF_KEY="$(openssl rand -hex 32)"
export PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=vpo_ci PGUSER=postgres
export PGPASSWORD="$(openssl rand -hex 24)"
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then echo "::add-mask::$PGPASSWORD"; echo "::add-mask::$VPO_CSRF_KEY"; fi
name="vpo-staging-$(openssl rand -hex 8)"
tmp="$(mktemp -d)"
server_pid=""
container_id=""
cleanup(){
 if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
 if [[ -n "$container_id" ]]; then docker stop "$container_id" >/dev/null 2>&1 || true; fi
 rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
container_id="$(POSTGRES_PASSWORD="$PGPASSWORD" docker run -d --rm --name "$name" --label vpo.synthetic=staging -e POSTGRES_DB=vpo_ci -e POSTGRES_PASSWORD -p 127.0.0.1:5432:5432 postgres:16)"
for i in $(seq 1 60); do
 if psql -XAt -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null 2>&1; then break; fi
 sleep 1
done
[[ "$(psql -XAt -v ON_ERROR_STOP=1 -c 'SELECT current_database()')" == vpo_ci ]]
[[ "$(psql -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_namespace WHERE nspname='vpo_stage'")" == 0 ]]
npm install --ignore-scripts --no-audit --no-fund
declare -A pass
roles=(vpo_migrator vpo_runtime vpo_provision ci_exam_a ci_exam_b ci_moderator ci_approver ci_publisher ci_finance ci_appeal ci_cert ci_cert_approver ci_mentor_a ci_mentor_b)
for role in "${roles[@]}"; do
 pass[$role]="$(openssl rand -hex 24)"
 if [[ "${GITHUB_ACTIONS:-}" == true ]]; then echo "::add-mask::${pass[$role]}"; fi
 printf "CREATE ROLE %s LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD '%s';\n" "$role" "${pass[$role]}" | psql -Xq -v ON_ERROR_STOP=1
done
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE vpo_demo_staff NOLOGIN;
CREATE ROLE vpo_demo_mentor NOLOGIN;
GRANT vpo_demo_staff TO ci_exam_a,ci_exam_b,ci_moderator,ci_approver,ci_publisher,ci_finance,ci_appeal,ci_cert,ci_cert_approver;
GRANT vpo_demo_mentor TO ci_mentor_a,ci_mentor_b;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON DATABASE vpo_ci TO vpo_migrator;
SQL
dburl(){ printf 'postgresql://%s:%s@127.0.0.1:5432/vpo_ci' "$1" "${pass[$1]}"; }
owner(){ PGUSER=vpo_migrator PGPASSWORD="${pass[vpo_migrator]}" psql -X -v ON_ERROR_STOP=1 "$@"; }
for migration in schema.sql grants.sql exam-schema.sql workflow-schema.sql workflow-functions.sql academy-schema.sql academy-functions.sql integrity.sql security-hardening.sql; do
 echo "Applying $migration"
 owner -q -f "$migration"
done
owner -q <<'SQL'
INSERT INTO vpo_stage.demo_staff(login_name,role) VALUES
 ('ci_exam_a','examiner'),('ci_exam_b','examiner'),('ci_moderator','moderator'),('ci_approver','approver'),('ci_publisher','publisher'),('ci_finance','finance'),('ci_appeal','appeal_reviewer'),('ci_cert','cert_officer'),('ci_cert_approver','cert_approver');
INSERT INTO vpo_stage.academy_mentors(login_name) VALUES ('ci_mentor_a'),('ci_mentor_b');
SQL
export VPO_TEST_A_EMAIL=learner-a@example.test VPO_TEST_B_EMAIL=learner-b@example.test
export VPO_TEST_A_PASSWORD="$(openssl rand -hex 24)" VPO_TEST_B_PASSWORD="$(openssl rand -hex 24)"
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then echo "::add-mask::$VPO_TEST_A_PASSWORD"; echo "::add-mask::$VPO_TEST_B_PASSWORD"; fi
export DATABASE_URL="$(dburl vpo_provision)"
printf '%s\n' "$VPO_TEST_A_PASSWORD" | node provision.cjs "$VPO_TEST_A_EMAIL"
printf '%s\n' "$VPO_TEST_B_PASSWORD" | node provision.cjs "$VPO_TEST_B_EMAIL"
owner -q -v demo_email="$VPO_TEST_A_EMAIL" -f exam-fixture.sql
export VPO_TEST_ROUND="$(owner -At -c 'SELECT id FROM vpo_stage.demo_rounds')"
owner -q -v demo_email="$VPO_TEST_A_EMAIL" -v mentor_login=ci_mentor_a -f academy-fixture.sql
export VPO_TEST_ACADEMY_ENROLMENT="$(owner -At -c 'SELECT id FROM vpo_stage.academy_enrolments')"
export VPO_TEST_MENTOR_DB="$(dburl ci_mentor_a)" VPO_TEST_OTHER_MENTOR_DB="$(dburl ci_mentor_b)"
export DATABASE_URL="$(dburl vpo_runtime)"
# Backend receives only its own database credential; do not pass migration or student secrets.
env -u PGPASSWORD -u VPO_TEST_A_PASSWORD -u VPO_TEST_B_PASSWORD -u VPO_TEST_MENTOR_DB -u VPO_TEST_OTHER_MENTOR_DB node server.cjs >"$tmp/server.log" 2>&1 &
server_pid=$!
host="${VPO_ORIGIN#*://}"
for i in $(seq 1 30); do
 if curl --noproxy '*' -fsS -H "Host: $host" http://127.0.0.1:8080/healthz >/dev/null 2>&1; then break; fi
 kill -0 "$server_pid" || { echo 'Backend stopped before readiness'; exit 1; }
 sleep 1
done
curl --noproxy '*' -fsS -H "Host: $host" http://127.0.0.1:8080/healthz >/dev/null
if [[ "$mode" == --check ]]; then
 node tests/staging-integration.cjs
 node tests/integration-smoke.cjs
 node tests/exam-integration.cjs
 node tests/academy-integration.cjs
 echo 'V5.7 fresh launch smoke PASS; not production acceptance.'
 exit 0
fi
echo '=== VPO PRIVATE STAGING / SYNTHETIC DATA ONLY ==='
printf 'Dashboard: %s/staging\nExam: %s/exam-demo\nAcademy: %s/academy-demo\n' "$VPO_ORIGIN" "$VPO_ORIGIN" "$VPO_ORIGIN"
printf 'A (enrolled): %s\nPassword A: %s\nB (not enrolled): %s\nPassword B: %s\nRound UUID: %s\n' "$VPO_TEST_A_EMAIL" "$VPO_TEST_A_PASSWORD" "$VPO_TEST_B_EMAIL" "$VPO_TEST_B_PASSWORD" "$VPO_TEST_ROUND"
echo 'Passwords are generated for this run only. Do not share terminal screenshots or real data.'
echo 'Keep the port Private. Ctrl+C stops this instance and deletes its disposable database.'
wait "$server_pid"
