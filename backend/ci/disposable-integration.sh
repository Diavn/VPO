#!/usr/bin/env bash
# ONLY on isolated GitHub Actions or Codespaces with a fresh disposable PostgreSQL service.
set -euo pipefail
[[ ( "${GITHUB_ACTIONS:-}" == true || "${CODESPACES:-}" == true ) && "${VPO_CI_DISPOSABLE:-}" == yes ]] || { echo 'Refusing: disposable CI only'; exit 1; }
cd "$(dirname "$0")/.."
export VPO_MODE=synthetic-staging VPO_ORIGIN=http://localhost:8080 VPO_PORT=8080
export VPO_CSRF_KEY="$(openssl rand -hex 32)"
export PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=vpo_ci PGUSER=postgres
# PGPASSWORD is the throwaway service credential from the CI job, not a production secret.
[[ "$(psql -XAt -v ON_ERROR_STOP=1 -c 'SELECT current_database()')" == vpo_ci ]]
[[ "$(psql -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_namespace WHERE nspname='vpo_stage'")" == 0 ]]
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
for migration in schema.sql grants.sql exam-schema.sql workflow-schema.sql workflow-functions.sql academy-schema.sql academy-functions.sql; do
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
node server.cjs > /tmp/vpo-ci-server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT
for i in $(seq 1 30); do
 if curl --noproxy '*' -fsS http://localhost:8080/healthz >/dev/null; then break; fi
 kill -0 "$server_pid" || { echo "Backend stopped"; exit 1; }
 sleep 1
done
curl --noproxy '*' -fsS http://localhost:8080/healthz >/dev/null
node tests/integration-smoke.cjs
node tests/exam-integration.cjs
attempt="$(owner -At -c 'SELECT attempt_id FROM vpo_stage.demo_submissions')"
owner -q -v attempt_id="$attempt" -v examiner_a=ci_exam_a -v examiner_b=ci_exam_b -f workflow-fixture.sql
export VPO_CI_CASE="$(owner -At -c 'SELECT id FROM vpo_stage.demo_marking_cases')"
export VPO_CI_ORDER="$(owner -At -c 'SELECT id FROM vpo_stage.demo_orders')"
export VPO_CI_TRANSFER="$(owner -At -c 'SELECT transfer_ref FROM vpo_stage.demo_statement_lines')"
for role in ci_exam_a ci_exam_b ci_moderator ci_approver ci_publisher ci_finance ci_appeal ci_cert ci_cert_approver; do
 key="VPO_DB_${role}"; export "$key=$(dburl "$role")"
done
node tests/workflow-integration.cjs
node tests/academy-integration.cjs
echo "Synthetic integration smoke passed; NOT a production acceptance."