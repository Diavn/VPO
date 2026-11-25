-- V5.3 synthetic staging only. Apply after all seven baseline migrations.
BEGIN;
-- Defence in depth: request-scoped profile RLS. The trusted shared runtime can
-- set its own context, so this is NOT a boundary against stolen DB credentials.
ALTER TABLE vpo_stage.student_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_runtime_read ON vpo_stage.student_profiles FOR SELECT TO vpo_runtime
 USING (user_id=nullif(current_setting('vpo.student_id',true),'')::uuid);
CREATE POLICY profile_runtime_update ON vpo_stage.student_profiles FOR UPDATE TO vpo_runtime
 USING (user_id=nullif(current_setting('vpo.student_id',true),'')::uuid)
 WITH CHECK (user_id=nullif(current_setting('vpo.student_id',true),'')::uuid);
CREATE POLICY profile_provision_insert ON vpo_stage.student_profiles FOR INSERT TO vpo_provision WITH CHECK (true);

-- The transaction lock serializes protected actions with session deletion,
-- suspension and role revocation. Owner grants only EXECUTE to runtime.
CREATE FUNCTION vpo_stage.lock_student_session(p_hash text,p_uid uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
BEGIN
 PERFORM 1 FROM vpo_stage.sessions s JOIN vpo_stage.users u ON u.id=s.user_id
 JOIN vpo_stage.role_grants g ON g.user_id=u.id
 WHERE s.token_hash=p_hash AND s.user_id=p_uid AND s.expires_at>clock_timestamp()
 AND s.idle_until>clock_timestamp() AND u.status='ACTIVE' AND g.role='student' AND g.revoked_at IS NULL
 FOR UPDATE OF s FOR SHARE OF u,g;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION vpo_stage.lock_student_session(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vpo_stage.lock_student_session(text,uuid) TO vpo_runtime;

-- Final-state assertions, deferred until commit because one transaction
-- inserts a draft/receipt and updates the attempt. Owner may bypass triggers;
-- these do not make the database tamper-proof.
CREATE FUNCTION vpo_stage.assert_attempt_integrity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,vpo_stage AS $$
DECLARE aid uuid; a vpo_stage.demo_attempts%ROWTYPE; r vpo_stage.demo_submissions%ROWTYPE; n bigint; hi integer; lo integer;
BEGIN
 IF TG_TABLE_NAME='demo_attempts' THEN aid:=NEW.id; ELSE aid:=NEW.attempt_id; END IF;
 SELECT * INTO a FROM vpo_stage.demo_attempts WHERE id=aid;
 IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_MISSING' USING ERRCODE='23514'; END IF;
 SELECT count(*),max(seq),min(seq) INTO n,hi,lo FROM vpo_stage.demo_drafts WHERE attempt_id=aid;
 IF n<>a.latest_seq::bigint+1 OR hi IS DISTINCT FROM a.latest_seq OR lo IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'REVISION_CHAIN_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM vpo_stage.demo_submissions WHERE attempt_id=aid;
 IF a.state='ACTIVE' THEN
  IF r.attempt_id IS NOT NULL THEN RAISE EXCEPTION 'ACTIVE_HAS_RECEIPT' USING ERRCODE='23514'; END IF;
 ELSE
  IF r.attempt_id IS NULL OR r.seq<>a.latest_seq OR (a.state='EXPIRED')<>(r.reason='DEADLINE') THEN RAISE EXCEPTION 'TERMINAL_RECEIPT_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER attempt_integrity AFTER INSERT OR UPDATE ON vpo_stage.demo_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vpo_stage.assert_attempt_integrity();
CREATE CONSTRAINT TRIGGER draft_integrity AFTER INSERT ON vpo_stage.demo_drafts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vpo_stage.assert_attempt_integrity();
CREATE CONSTRAINT TRIGGER receipt_integrity AFTER INSERT ON vpo_stage.demo_submissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vpo_stage.assert_attempt_integrity();

CREATE FUNCTION vpo_stage.guard_attempt_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,vpo_stage AS $$
BEGIN
 IF OLD.state<>'ACTIVE' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.latest_seq IS DISTINCT FROM OLD.latest_seq) THEN RAISE EXCEPTION 'TERMINAL_ATTEMPT' USING ERRCODE='23514'; END IF;
 IF NEW.latest_seq<OLD.latest_seq OR NEW.latest_seq>OLD.latest_seq+1 THEN RAISE EXCEPTION 'INVALID_SEQUENCE_TRANSITION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attempt_transition BEFORE UPDATE ON vpo_stage.demo_attempts FOR EACH ROW EXECUTE FUNCTION vpo_stage.guard_attempt_update();
CREATE FUNCTION vpo_stage.guard_draft_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,vpo_stage AS $$
DECLARE a vpo_stage.demo_attempts%ROWTYPE;
BEGIN
 SELECT * INTO a FROM vpo_stage.demo_attempts WHERE id=NEW.attempt_id FOR UPDATE;
 IF NOT FOUND OR a.state<>'ACTIVE' OR NEW.seq>2000 OR (NEW.seq<>0 AND NEW.seq<>a.latest_seq+1) OR (NEW.seq=0 AND (a.latest_seq<>0 OR NEW.body<>'')) OR NEW.saved_at>=a.deadline THEN RAISE EXCEPTION 'DRAFT_INSERT_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER draft_insert_guard BEFORE INSERT ON vpo_stage.demo_drafts FOR EACH ROW EXECUTE FUNCTION vpo_stage.guard_draft_insert();
REVOKE ALL ON FUNCTION vpo_stage.assert_attempt_integrity(),vpo_stage.guard_attempt_update(),vpo_stage.guard_draft_insert() FROM PUBLIC;
COMMIT;