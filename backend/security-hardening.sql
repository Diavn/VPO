-- V5.6 synthetic staging. Apply after integrity.sql, migration owner only.
BEGIN;
ALTER TABLE vpo_stage.users ADD COLUMN auth_epoch bigint NOT NULL DEFAULT 1 CHECK(auth_epoch>0);
ALTER TABLE vpo_stage.role_grants ADD COLUMN auth_epoch bigint NOT NULL DEFAULT 1 CHECK(auth_epoch>0);
ALTER TABLE vpo_stage.sessions ADD COLUMN user_epoch bigint NOT NULL DEFAULT 1 CHECK(user_epoch>0);
ALTER TABLE vpo_stage.sessions ADD COLUMN grant_epoch bigint NOT NULL DEFAULT 1 CHECK(grant_epoch>0);
-- Epoch increments invalidate every previously issued session, without locking/deleting
-- session rows from a user/grant trigger (which would invert the lock order).
CREATE FUNCTION vpo_stage.bump_user_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,vpo_stage AS $$
BEGIN
 NEW.auth_epoch:=OLD.auth_epoch;
 IF NEW.status IS DISTINCT FROM OLD.status OR NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.email IS DISTINCT FROM OLD.email THEN NEW.auth_epoch:=OLD.auth_epoch+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER user_epoch BEFORE UPDATE ON vpo_stage.users FOR EACH ROW EXECUTE FUNCTION vpo_stage.bump_user_epoch();
CREATE FUNCTION vpo_stage.bump_grant_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,vpo_stage AS $$
BEGIN
 NEW.auth_epoch:=OLD.auth_epoch;
 IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN NEW.auth_epoch:=OLD.auth_epoch+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER grant_epoch BEFORE UPDATE ON vpo_stage.role_grants FOR EACH ROW EXECUTE FUNCTION vpo_stage.bump_grant_epoch();
-- Do not delete/recreate grant rows in this slice: preserve revocation history and epoch.
CREATE FUNCTION vpo_stage.prevent_grant_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,vpo_stage AS $$
BEGIN RAISE EXCEPTION 'USE_REVOCATION_NOT_DELETE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER grant_no_delete BEFORE DELETE ON vpo_stage.role_grants FOR EACH ROW EXECUTE FUNCTION vpo_stage.prevent_grant_delete();
CREATE OR REPLACE FUNCTION vpo_stage.lock_student_session(p_hash text,p_uid uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
BEGIN
 PERFORM 1 FROM vpo_stage.sessions s JOIN vpo_stage.users u ON u.id=s.user_id
 JOIN vpo_stage.role_grants g ON g.user_id=u.id
 WHERE s.token_hash=p_hash AND s.user_id=p_uid AND s.expires_at>clock_timestamp()
 AND s.idle_until>clock_timestamp() AND u.status='ACTIVE' AND g.role='student' AND g.revoked_at IS NULL
 AND s.user_epoch=u.auth_epoch AND s.grant_epoch=g.auth_epoch
 FOR UPDATE OF s FOR SHARE OF u,g;
 RETURN FOUND;
END $$;
-- Login issuance checks the credential/role version observed before password hashing.
CREATE FUNCTION vpo_stage.issue_student_session(p_uid uuid,p_hash text,p_user_epoch bigint,p_grant_epoch bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
BEGIN
 PERFORM 1 FROM vpo_stage.users u JOIN vpo_stage.role_grants g ON g.user_id=u.id
 WHERE u.id=p_uid AND u.status='ACTIVE' AND g.role='student' AND g.revoked_at IS NULL AND u.auth_epoch=p_user_epoch AND g.auth_epoch=p_grant_epoch FOR SHARE OF u,g;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO vpo_stage.sessions(token_hash,user_id,expires_at,idle_until,user_epoch,grant_epoch)
 VALUES(p_hash,p_uid,clock_timestamp()+interval '8 hours',clock_timestamp()+interval '30 minutes',p_user_epoch,p_grant_epoch);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION vpo_stage.bump_user_epoch(),vpo_stage.bump_grant_epoch(),vpo_stage.prevent_grant_delete(),vpo_stage.issue_student_session(uuid,text,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vpo_stage.issue_student_session(uuid,text,bigint,bigint) TO vpo_runtime;
REVOKE INSERT ON vpo_stage.sessions FROM vpo_runtime;
-- Invalidate pre-migration sessions rather than assume their prior epoch.
DELETE FROM vpo_stage.sessions;
COMMIT;