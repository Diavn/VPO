#!/usr/bin/env bash
# Isolated CI service only. Backend must already be stopped; no real backups.
set -euo pipefail
[[ ( "GITHUB_ACTIONS" == true || "CODESPACES" == true ) && "VPO_CI_DISPOSABLE" == yes ]]
[[ "$PGHOST" == 127.0.0.1 && "$PGPORT" == 5432 && "$PGDATABASE" == vpo_ci && "$PGUSER" == postgres ]]
if curl --noproxy '*' -fsS http://localhost:8080/healthz >/dev/null 2>&1; then echo 'Refusing: backend still active'; exit 1; fi
[[ "$(psql -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_database WHERE datname='vpo_ci_restore'")" == 0 ]]
umask 077
tmp="$(mktemp -d)"
created=no
cleanup(){ if [[ "$created" == yes ]]; then dropdb --if-exists vpo_ci_restore >/dev/null 2>&1 || true; fi; rm -rf "$tmp"; }
trap cleanup EXIT
# Stable per-table row counts and content digest. Synthetic snapshot, not a cryptographic proof of provenance.
snapshot(){ PGDATABASE="$1" psql -XAt -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('SELECT %L,count(*),coalesce(md5(string_agg(h, '''' ORDER BY h)),md5('''')) FROM (SELECT md5(to_jsonb(t)::text) h FROM vpo_stage.%I t) q;',tablename,tablename) FROM pg_tables WHERE schemaname='vpo_stage' ORDER BY tablename
\gexec
SQL
}
start="$(date +%s)"
snapshot vpo_ci > "$tmp/before"
[[ "$(wc -l < "$tmp/before" | tr -d ' ')" == 32 ]]
pg_dump --format=custom --schema=vpo_stage --file="$tmp/stage.dump" vpo_ci
createdb -T template0 vpo_ci_restore
created=yes
PGDATABASE=vpo_ci_restore psql -Xq -v ON_ERROR_STOP=1 -c 'REVOKE CREATE ON SCHEMA public FROM PUBLIC'
pg_restore --exit-on-error --dbname=vpo_ci_restore "$tmp/stage.dump"
snapshot vpo_ci_restore > "$tmp/after"
cmp -s "$tmp/before" "$tmp/after" || { echo 'Restore content mismatch'; exit 1; }
# Same cluster roles exist; ACL/RLS must survive restore.
PGDATABASE=vpo_ci_restore psql -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL ROLE vpo_runtime;
DO $$ BEGIN
 IF (SELECT count(*) FROM vpo_stage.student_profiles)<>0 THEN RAISE EXCEPTION 'RLS failed'; END IF;
 IF has_table_privilege(current_user,'vpo_stage.demo_drafts','UPDATE') OR has_table_privilege(current_user,'vpo_stage.demo_submissions','DELETE') THEN RAISE EXCEPTION 'Restore grants invalid'; END IF;
 IF NOT has_function_privilege(current_user,'vpo_stage.lock_student_session(text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Missing session routine privilege'; END IF;
END $$;
ROLLBACK;
SQL
echo "RESTORE PASS: all 32 table row counts/content digests match, sampled ACL/RLS preserved; elapsed $(( $(date +%s)-start )) seconds."
echo 'Offline same-cluster logical restore only; not PITR, disaster recovery or production RTO/RPO evidence.'
