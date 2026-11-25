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
ports=(5432 8080 8082 8091)
[[ "$mode" != --check ]] || ports+=(8081 8090)
for port in "${ports[@]}"; do
 if (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then echo "Port $port occupied; refusing to touch existing services"; exit 1; fi
done
export VPO_MODE=synthetic-staging VPO_PORT=8080 VPO_ORIGIN=http://localhost:8080 VPO_CODESPACES_PROXY=no
if [[ "$mode" != --check ]]; then
 echo 'Forward only 8091 as Private (8081 only for local staff desk). Remove existing 8080/8082 forwarding; never forward PostgreSQL (5432).'
 read -r -p 'Type PRIVATE to confirm: ' confirmation
 [[ "$confirmation" == PRIVATE ]] || exit 1
fi
if [[ "$mode" == private ]]; then
 [[ "${CODESPACE_NAME:-}" =~ ^[a-zA-Z0-9-]+$ && "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'Cannot derive exact Codespaces origin'; exit 1; }
 export VPO_CODESPACES_PROXY=yes
 export VPO_ORIGIN="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi
export VPO_CSRF_KEY="$(openssl rand -hex 32)"
export PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=vpo_ci PGUSER=postgres
export PGPASSWORD="$(openssl rand -hex 24)"
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then echo "::add-mask::$PGPASSWORD"; echo "::add-mask::$VPO_CSRF_KEY"; fi
name="vpo-staging-$(openssl rand -hex 8)"
tmp="$(mktemp -d)"
server_pid=""
desk_pid=""
accounts_pid=""
gateway_pid=""
container_id=""
cleanup(){
 if [[ -n "$gateway_pid" ]]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi
 if [[ -n "$accounts_pid" ]]; then kill "$accounts_pid" 2>/dev/null || true; wait "$accounts_pid" 2>/dev/null || true; fi
 if [[ -n "$desk_pid" ]]; then kill "$desk_pid" 2>/dev/null || true; wait "$desk_pid" 2>/dev/null || true; fi
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
roles=(vpo_migrator vpo_runtime vpo_provision vpo_accounts ci_exam_a ci_exam_b ci_moderator ci_approver ci_publisher ci_finance ci_appeal ci_cert ci_cert_approver ci_mentor_a ci_mentor_b)
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
for migration in schema.sql grants.sql exam-schema.sql workflow-schema.sql workflow-functions.sql academy-schema.sql academy-functions.sql integrity.sql security-hardening.sql account-management.sql admin-center.sql account-security.sql content-management.sql academic-admin.sql operational-finance.sql; do
 echo "Applying $migration"
 owner -q -f "$migration"
done
[[ "$(owner -At -c "SELECT count(*) FROM pg_tables WHERE schemaname='vpo_stage'")" == 37 ]] || { echo "Unexpected schema table count"; exit 1; }
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
# Admin password never stored in source, CLI arguments, or the service environment.
if [[ "$mode" == --check ]]; then
 admin_password="$(openssl rand -hex 24)"
 if [[ "${GITHUB_ACTIONS:-}" == true ]]; then echo "::add-mask::$admin_password"; fi
else
 read -r -s -p 'Set NEW admin password (at least 15 UTF-8 bytes): ' admin_password; echo
 read -r -s -p 'Confirm admin password: ' admin_confirm; echo
 [[ "$admin_password" == "$admin_confirm" ]] || { echo 'Passwords do not match'; exit 1; }
 unset admin_confirm
fi
admin_hash="$(printf '%s' "$admin_password" | node -e 'const S=require("./security.cjs");let p="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>p+=x);process.stdin.on("end",()=>S.hashPassword(p).then(console.log).catch(()=>{console.error("Password policy refused");process.exitCode=1;}));')"
mail_dir="$tmp/mail"; mkdir -m 700 "$mail_dir"
mail_key="$(openssl rand -hex 32)"
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then echo "::add-mask::$admin_hash"; echo "::add-mask::$mail_key"; fi
account_origin=http://localhost:8082
if [[ "$mode" == private ]]; then account_origin="https://${CODESPACE_NAME}-8082.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"; fi
env -i PATH="$PATH" CODESPACES="${CODESPACES:-}" GITHUB_ACTIONS="${GITHUB_ACTIONS:-}" VPO_MODE=synthetic-staging VPO_ORIGIN="$account_origin" VPO_CODESPACES_PROXY="$VPO_CODESPACES_PROXY" CODESPACE_NAME="${CODESPACE_NAME:-}" GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" VPO_CSRF_KEY="$(openssl rand -hex 32)" VPO_ADMIN_HASH="$admin_hash" VPO_MAIL_KEY="$mail_key" VPO_MAIL_DIR="$mail_dir" DATABASE_URL="$(dburl vpo_accounts)" node account-client/server.cjs >"$tmp/accounts.log" 2>&1 &
accounts_pid=$!
[[ "$mode" == --check ]] || unset admin_hash mail_key
for i in $(seq 1 30); do
 if curl --noproxy '*' -fsS -H "Host: ${account_origin#*://}" http://127.0.0.1:8082/healthz >/dev/null 2>&1; then break; fi
 kill -0 "$accounts_pid" || { echo 'Account service stopped'; exit 1; }
 sleep 1
done
curl --noproxy '*' -fsS -H "Host: ${account_origin#*://}" http://127.0.0.1:8082/healthz >/dev/null
gateway_origin=http://localhost:8091
if [[ "$mode" == private ]]; then gateway_origin="https://${CODESPACE_NAME}-8091.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"; fi
env -i PATH="$PATH" CODESPACES="${CODESPACES:-}" GITHUB_ACTIONS="${GITHUB_ACTIONS:-}" VPO_MODE=synthetic-staging VPO_ORIGIN="$gateway_origin" VPO_CODESPACES_PROXY="$VPO_CODESPACES_PROXY" CODESPACE_NAME="${CODESPACE_NAME:-}" GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" node gateway/server.cjs >"$tmp/gateway.log" 2>&1 &
gateway_pid=$!
for i in $(seq 1 30); do
 if curl --noproxy '*' -fsS -H "Host: ${gateway_origin#*://}" http://127.0.0.1:8091/healthz >/dev/null 2>&1; then break; fi
 kill -0 "$gateway_pid" || { echo 'Gateway stopped'; exit 1; }
 sleep 1
done
curl --noproxy '*' -fsS -H "Host: ${gateway_origin#*://}" http://127.0.0.1:8091/healthz >/dev/null
if [[ "$mode" == --check ]]; then
 VPO_TEST_ADMIN_PASSWORD="$admin_password" VPO_TEST_MAIL_DIR="$mail_dir" node tests/account-management.cjs
fi
[[ "$mode" == --check ]] || unset admin_password
if [[ "$mode" == --check ]]; then
 node tests/staging-integration.cjs
 node tests/integration-smoke.cjs
 node tests/exam-integration.cjs
 # Only the first synthetic round has a submitted attempt at this point.
 attempt="$(owner -At -c "SELECT s.attempt_id FROM vpo_stage.demo_submissions s JOIN vpo_stage.demo_attempts a ON a.id=s.attempt_id WHERE a.round_id='$VPO_TEST_ROUND'::uuid")"
 [[ "$attempt" =~ ^[a-f0-9-]{36}$ ]]
 owner -q -v attempt_id="$attempt" -v examiner_a=ci_exam_a -v examiner_b=ci_exam_b -f workflow-fixture.sql >/dev/null
 export VPO_CI_CASE="$(owner -At -c 'SELECT id FROM vpo_stage.demo_marking_cases')"
 export VPO_CI_ORDER="$(owner -At -c 'SELECT id FROM vpo_stage.demo_orders')"
 export VPO_CI_TRANSFER="$(owner -At -c 'SELECT transfer_ref FROM vpo_stage.demo_statement_lines')"
 export VPO_CI_DISPOSABLE=yes VPO_CI_OWNER_DB="$(dburl vpo_migrator)"
 for role in ci_exam_a ci_exam_b ci_moderator ci_approver ci_publisher ci_finance ci_appeal ci_cert ci_cert_approver; do
  key="VPO_DB_$role"; export "$key=$(dburl "$role")"
 done
 node tests/workflow-integration.cjs
 node tests/academy-integration.cjs
 node tests/integrity-integration.cjs
 node tests/browser-integration.cjs
 node tests/security-integration.cjs
 node tests/mock-deadline.cjs
 node tests/load-pilot.cjs
 VPO_TEST_ADMIN_PASSWORD="$admin_password" VPO_TEST_MAIL_DIR="$mail_dir" node tests/unified-integration.cjs
 kill "$gateway_pid"; wait "$gateway_pid"; gateway_pid=""
 # Stop all HTTP writers before proxy simulation and offline restore.
 kill "$accounts_pid"; wait "$accounts_pid"; accounts_pid=""
 kill "$server_pid"; wait "$server_pid"; server_pid=""
 VPO_TEST_ACCOUNTS_DB="$(dburl vpo_accounts)" VPO_TEST_ADMIN_HASH="$admin_hash" VPO_TEST_MAIL_KEY="$mail_key" VPO_TEST_MAIL_DIR="$mail_dir" VPO_TEST_ADMIN_PASSWORD="$admin_password" node tests/proxy-integration.cjs
 unset admin_hash mail_key admin_password
 bash ci/backup-restore-pilot.sh
 echo 'V6.6.1 master regression PASS; synthetic only; real proxy UAT and production acceptance not established.'
 exit 0
fi
echo '=== VPO PRIVATE STAGING / SYNTHETIC DATA ONLY ==='
printf 'Unified website: %s/\nAdmin: %s/admin (username admin)\nRegistration: %s/register\nForward only 8091 Private.\n' "$gateway_origin" "$gateway_origin" "$gateway_origin"
printf 'Dashboard: %s/staging\nExam: %s/exam-demo\nAcademy: %s/academy-demo\n' "$gateway_origin" "$gateway_origin" "$gateway_origin"
printf 'A (enrolled): %s\nPassword A: %s\nB (not enrolled): %s\nPassword B: %s\nRound UUID: %s\n' "$VPO_TEST_A_EMAIL" "$VPO_TEST_A_PASSWORD" "$VPO_TEST_B_EMAIL" "$VPO_TEST_B_PASSWORD" "$VPO_TEST_ROUND"
echo 'Passwords are generated for this run only. Do not share terminal screenshots or real data.'
echo 'Keep the port Private. Ctrl+C stops this instance and deletes its disposable database.'
# Optional owner-operated synthetic staff console. One human may simulate roles;
# role-separated DB credentials stay in this process; no independent human sign-off.
echo 'Operator commands: seed | staff ROLE OP [UUID] | desk ROLE | desk-stop | mail UUID | diagnose | quit'
echo 'For staff mutations, enter JSON on the next line (or {} for no arguments).'
while kill -0 "$server_pid" 2>/dev/null && kill -0 "$accounts_pid" 2>/dev/null && kill -0 "$gateway_pid" 2>/dev/null; do
 read -r -p 'VPO mock> ' cmd role action obj extra || break
 case "$cmd" in
 quit) break;;
 diagnose)
  echo "Build: $(git rev-parse --short HEAD) (working tree; running code may differ)";
  printf "Student HTTP: "; curl --noproxy "*" -sS -o /dev/null -w "%{http_code}\\n" -H "Host: $host" http://127.0.0.1:8080/healthz || true
  printf "Account HTTP: "; curl --noproxy "*" -sS -o /dev/null -w "%{http_code}\\n" -H "Host: ${account_origin#*://}" http://127.0.0.1:8082/healthz || true
  printf "Unified HTTP: "; curl --noproxy "*" -sS -o /dev/null -w "%{http_code}\n" -H "Host: ${gateway_origin#*://}" http://127.0.0.1:8091/healthz || true
  echo "Recent rejected Host, Origin and GET route values (no credentials):"; grep -hE "^(HOST_REJECTED|ORIGIN_REJECTED|ROUTE_REJECTED) " "$tmp/accounts.log" "$tmp/server.log" "$tmp/gateway.log" | tail -n 10 || true;;
 mail)
  [[ "$role" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$ && -z "$action$obj$extra" ]] || { echo 'Usage: mail UUID'; continue; }
  if [[ -f "$mail_dir/$role.json" ]]; then cat "$mail_dir/$role.json"; echo; else echo 'No matching synthetic message'; fi;;
 desk-stop)
  if [[ -n "$desk_pid" ]]; then kill "$desk_pid" 2>/dev/null || true; wait "$desk_pid" 2>/dev/null || true; desk_pid=""; fi;;
 desk)
  [[ "$mode" == local ]] || { echo "Staff desk requires local mode and private desktop port forwarding (8081)."; continue; }
  [[ -z "$action$obj$extra" ]] || { echo "Usage: desk ROLE"; continue; }
  case "$role" in ci_exam_a|ci_exam_b|ci_moderator|ci_approver|ci_publisher|ci_finance|ci_appeal|ci_cert|ci_cert_approver) ;; *) echo "Unknown role"; continue;; esac
  if [[ -n "$desk_pid" ]]; then echo "Stop current desk first: desk-stop"; continue; fi
  if (echo >/dev/tcp/127.0.0.1/8081) 2>/dev/null; then echo "Port 8081 occupied"; continue; fi
  read -r -p "Confirm private desktop forwarding only; type LOCAL: " desk_confirm
  [[ "$desk_confirm" == LOCAL ]] || continue
  desk_key="$(openssl rand -hex 32)"
  env -i PATH="$PATH" CODESPACES=true VPO_MODE=synthetic-staging VPO_DESK_ROLE="$role" VPO_DESK_KEY="$desk_key" DATABASE_URL="$(dburl "$role")" node staff-desk/server.cjs >"$tmp/desk.log" 2>&1 &
  desk_pid=$!
  ready=no
  for i in $(seq 1 20); do
   if curl --noproxy "*" -fsS http://localhost:8081/ >/dev/null 2>&1; then ready=yes; break; fi
   kill -0 "$desk_pid" 2>/dev/null || break
   sleep 1
  done
  if [[ "$ready" == yes ]] && kill -0 "$desk_pid" 2>/dev/null; then printf "Staff desk: http://localhost:8081/\nOne-run access key: %s\n" "$desk_key"; else echo "Desk startup failed"; kill "$desk_pid" 2>/dev/null || true; wait "$desk_pid" 2>/dev/null || true; desk_pid=""; fi
  unset desk_key;;
 seed)
  [[ -z "$role$action$obj$extra" ]] || { echo 'Usage: seed'; continue; }
  attempt="$(owner -At -v round="$VPO_TEST_ROUND" -v email="$VPO_TEST_A_EMAIL" <<'SQL'
SELECT s.attempt_id FROM vpo_stage.demo_submissions s JOIN vpo_stage.demo_attempts a ON a.id=s.attempt_id JOIN vpo_stage.users u ON u.id=a.user_id WHERE a.round_id=:'round'::uuid AND u.email=:'email';
SQL
)"
  [[ "$attempt" =~ ^[a-f0-9-]{36}$ ]] || { echo 'Submit A’s mock essay first.'; continue; }
  if ! owner -q -v attempt_id="$attempt" -v examiner_a=ci_exam_a -v examiner_b=ci_exam_b -f workflow-fixture.sql; then echo 'Fixture already exists or could not be seeded.'; fi;;
 staff)
  [[ -z "$extra" ]] || { echo 'Usage: staff ROLE OP [UUID]'; continue; }
  case "$role" in ci_exam_a|ci_exam_b|ci_moderator|ci_approver|ci_publisher|ci_finance|ci_appeal|ci_cert|ci_cert_approver) ;; *) echo 'Unknown role'; continue;; esac
  read -r -p 'JSON payload: ' payload || break
  args=("$action"); [[ -z "$obj" ]] || args+=("$obj")
  printf '%s\n' "$payload" | env -u PGPASSWORD -u VPO_TEST_A_PASSWORD -u VPO_TEST_B_PASSWORD DATABASE_URL="$(dburl "$role")" node workflow-cli.cjs "${args[@]}" || echo 'Operation refused (check role/state/input).';;
 *) echo 'Commands: seed | staff ROLE OP [UUID] | desk ROLE | desk-stop | mail UUID | diagnose | quit';;
 esac
done
