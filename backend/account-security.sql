-- V6.4 synthetic account recovery and round retry reliability.
BEGIN;
ALTER TABLE vpo_stage.demo_rounds ADD COLUMN creation_op uuid UNIQUE;
DROP FUNCTION vpo_stage.admin_create_round(text,timestamptz,timestamptz,integer,text);
CREATE FUNCTION vpo_stage.admin_create_round(p_op uuid,p_label text,p_open timestamptz,p_close timestamptz,p_duration integer,p_topic text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $create$
DECLARE rid uuid; prior vpo_stage.demo_rounds%ROWTYPE; n timestamptz:=clock_timestamp();
BEGIN
 IF p_op IS NULL THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_op::text,648));
 SELECT * INTO prior FROM vpo_stage.demo_rounds WHERE creation_op=p_op;
 IF FOUND THEN
  IF ROW(prior.label,prior.opens_at,prior.closes_at,prior.duration_seconds,prior.topic) IS DISTINCT FROM ROW(p_label,p_open,p_close,p_duration,p_topic) THEN RETURN jsonb_build_object('result','CONFLICT'); END IF;
  RETURN jsonb_build_object('result','REPLAY','id',prior.id);
 END IF;
 IF p_label IS NULL OR p_label NOT LIKE 'DEMO %' OR length(p_label)>120 OR length(trim(p_label))<6
 OR p_open IS NULL OR p_close IS NULL OR p_open<n-interval '5 minutes' OR p_open>n+interval '1 year'
 OR p_close<=n OR p_close<=p_open OR p_close>p_open+interval '7 days'
 OR p_duration IS NULL OR p_duration NOT BETWEEN 60 AND 14400
 OR p_close-p_open<make_interval(secs=>p_duration)
 OR p_topic IS NULL OR octet_length(p_topic) NOT BETWEEN 1 AND 8000 OR length(trim(p_topic))=0 THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 INSERT INTO vpo_stage.demo_rounds(label,opens_at,closes_at,duration_seconds,topic,creation_op)
 VALUES(p_label,p_open,p_close,p_duration,p_topic,p_op) RETURNING id INTO rid;
 INSERT INTO vpo_stage.account_admin_audit(action,round_id) VALUES('ROUND_CREATED',rid);
 RETURN jsonb_build_object('result','CREATED','id',rid);
END $create$;
CREATE TABLE vpo_stage.password_reset_challenges(
 id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES vpo_stage.users(id),
 user_epoch bigint NOT NULL, grant_epoch bigint NOT NULL,
 code_mac text NOT NULL CHECK(code_mac ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
);
CREATE FUNCTION vpo_stage.password_reset_begin(p_id uuid,p_email text,p_mac text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $reset_begin$
DECLARE u vpo_stage.users%ROWTYPE; g_epoch bigint;
BEGIN
 IF p_id IS NULL OR p_email IS NULL OR p_email !~ '^[a-z0-9][a-z0-9._+-]*@example\.test$' OR length(p_email)>120 OR p_mac IS NULL OR p_mac !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 SELECT * INTO u FROM vpo_stage.users WHERE email=p_email FOR UPDATE;
 IF NOT FOUND OR u.status<>'ACTIVE' OR u.deleted_at IS NOT NULL OR u.email_verified_at IS NULL THEN RETURN false; END IF;
 SELECT auth_epoch INTO g_epoch FROM vpo_stage.role_grants WHERE user_id=u.id AND role='student' AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO vpo_stage.password_reset_challenges(id,user_id,user_epoch,grant_epoch,code_mac) VALUES(p_id,u.id,u.auth_epoch,g_epoch,p_mac)
 ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,user_epoch=excluded.user_epoch,grant_epoch=excluded.grant_epoch,code_mac=excluded.code_mac,created_at=excluded.created_at,expires_at=excluded.expires_at,attempts=0
 WHERE vpo_stage.password_reset_challenges.created_at<=clock_timestamp()-interval '60 seconds';
 RETURN FOUND;
END $reset_begin$;
CREATE FUNCTION vpo_stage.password_reset_finish(p_id uuid,p_mac text,p_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $reset_finish$
DECLARE c vpo_stage.password_reset_challenges%ROWTYPE; u vpo_stage.users%ROWTYPE; uid uuid; g_epoch bigint;
BEGIN
 -- Lock user first, consistent with begin and account administration.
 SELECT user_id INTO uid FROM vpo_stage.password_reset_challenges WHERE id=p_id;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO u FROM vpo_stage.users WHERE id=uid FOR UPDATE;
 IF NOT FOUND OR u.status<>'ACTIVE' OR u.deleted_at IS NOT NULL OR u.email_verified_at IS NULL THEN RETURN false; END IF;
 SELECT auth_epoch INTO g_epoch FROM vpo_stage.role_grants WHERE user_id=uid AND role='student' AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO c FROM vpo_stage.password_reset_challenges WHERE id=p_id AND user_id=uid FOR UPDATE;
 IF NOT FOUND OR c.expires_at<=clock_timestamp() OR c.attempts>=5 OR c.user_epoch<>u.auth_epoch OR c.grant_epoch<>g_epoch THEN RETURN false; END IF;
 IF c.code_mac IS DISTINCT FROM p_mac THEN
  UPDATE vpo_stage.password_reset_challenges SET attempts=attempts+1 WHERE id=p_id; RETURN false;
 END IF;
 IF p_hash IS NULL OR p_hash !~ '^s1:[a-f0-9]{32}:[a-f0-9]{128}$' THEN RETURN false; END IF;
 -- Prevent session disruption of an active attempt; keep valid challenge for later retry until expiry.
 IF EXISTS(SELECT 1 FROM vpo_stage.demo_attempts WHERE user_id=uid AND state='ACTIVE') THEN RETURN false; END IF;
 UPDATE vpo_stage.users SET password_hash=p_hash WHERE id=uid;
 DELETE FROM vpo_stage.password_reset_challenges WHERE id=p_id;
 INSERT INTO vpo_stage.account_admin_audit(action,user_id) VALUES('PASSWORD_RESET',uid);
 RETURN true;
END $reset_finish$;
REVOKE ALL ON vpo_stage.password_reset_challenges FROM PUBLIC;
REVOKE ALL ON FUNCTION vpo_stage.admin_create_round(uuid,text,timestamptz,timestamptz,integer,text),vpo_stage.password_reset_begin(uuid,text,text),vpo_stage.password_reset_finish(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vpo_stage.admin_create_round(uuid,text,timestamptz,timestamptz,integer,text),vpo_stage.password_reset_begin(uuid,text,text),vpo_stage.password_reset_finish(uuid,text,text) TO vpo_accounts;
COMMIT;
