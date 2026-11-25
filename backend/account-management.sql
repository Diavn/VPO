-- Synthetic account lifecycle. Migration owner only. No real email delivery.
BEGIN;
ALTER TABLE vpo_stage.users ADD COLUMN deleted_at timestamptz, ADD COLUMN email_verified_at timestamptz;
-- Existing fixtures are explicitly operator-created, not email-verified.
CREATE TABLE vpo_stage.registration_challenges(
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE CHECK(email ~ '^[a-z0-9][a-z0-9._+-]*@example\.test$'),
 code_mac text NOT NULL CHECK(length(code_mac)=64), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
);
CREATE TABLE vpo_stage.account_admin_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action text NOT NULL,
 user_id uuid REFERENCES vpo_stage.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION vpo_stage.registration_begin(p_id uuid,p_email text,p_mac text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
BEGIN
 IF p_email !~ '^[a-z0-9][a-z0-9._+-]*@example\.test$' OR length(p_email)>120 OR p_mac !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM vpo_stage.users WHERE email=p_email) THEN RETURN false; END IF;
 INSERT INTO vpo_stage.registration_challenges(id,email,code_mac) VALUES(p_id,p_email,p_mac)
 ON CONFLICT(email) DO UPDATE SET id=excluded.id,code_mac=excluded.code_mac,created_at=excluded.created_at,expires_at=excluded.expires_at,attempts=0
 WHERE vpo_stage.registration_challenges.created_at<=clock_timestamp()-interval '60 seconds';
 RETURN FOUND;
END $$;
CREATE FUNCTION vpo_stage.registration_finish(p_id uuid,p_mac text,p_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
DECLARE c vpo_stage.registration_challenges%ROWTYPE; uid uuid;
BEGIN
 SELECT * INTO c FROM vpo_stage.registration_challenges WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR c.expires_at<=clock_timestamp() OR c.attempts>=5 THEN RETURN false; END IF;
 IF c.code_mac IS DISTINCT FROM p_mac THEN
  UPDATE vpo_stage.registration_challenges SET attempts=attempts+1 WHERE id=p_id; RETURN false;
 END IF;
 IF p_hash !~ '^s1:[a-f0-9]{32}:[a-f0-9]{128}$' THEN RETURN false; END IF;
 INSERT INTO vpo_stage.users(email,password_hash,status,email_verified_at) VALUES(c.email,p_hash,'ACTIVE',clock_timestamp()) ON CONFLICT(email) DO NOTHING RETURNING id INTO uid;
 DELETE FROM vpo_stage.registration_challenges WHERE id=p_id;
 IF uid IS NULL THEN RETURN false; END IF;
 INSERT INTO vpo_stage.role_grants(user_id,role) VALUES(uid,'student');
 INSERT INTO vpo_stage.student_profiles(user_id,student_code,name_vi,name_latin,grade,curriculum,locale) VALUES(uid,'DEMO-'||replace(gen_random_uuid()::text,'-',''),'HOC SINH MAU','EXAMPLE STUDENT','11','DEMO-VN','vi');
 INSERT INTO vpo_stage.account_admin_audit(action,user_id) VALUES('EMAIL_VERIFIED',uid);
 RETURN true;
END $$;
CREATE FUNCTION vpo_stage.account_admin_list(p_search text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) FROM
 (SELECT id,email,CASE WHEN deleted_at IS NOT NULL THEN 'DELETED' ELSE status END AS status,email_verified_at,created_at
 FROM vpo_stage.users WHERE strpos(email,lower(p_search))>0 OR p_search='' ORDER BY created_at DESC,id LIMIT 200) z
$$;
CREATE FUNCTION vpo_stage.account_admin_change(p_uid uuid,p_op text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
DECLARE u vpo_stage.users%ROWTYPE;
BEGIN
 SELECT * INTO u FROM vpo_stage.users WHERE id=p_uid FOR UPDATE;
 IF NOT FOUND OR u.deleted_at IS NOT NULL OR p_op NOT IN ('suspend','activate','delete') THEN RETURN false; END IF;
 IF p_op='delete' AND EXISTS(SELECT 1 FROM vpo_stage.demo_attempts WHERE user_id=p_uid AND state='ACTIVE') THEN RETURN false; END IF;
 IF p_op='activate' THEN UPDATE vpo_stage.users SET status='ACTIVE' WHERE id=p_uid;
 ELSIF p_op='suspend' THEN UPDATE vpo_stage.users SET status='SUSPENDED' WHERE id=p_uid;
 ELSE UPDATE vpo_stage.users SET status='SUSPENDED',deleted_at=clock_timestamp() WHERE id=p_uid; END IF;
 INSERT INTO vpo_stage.account_admin_audit(action,user_id) VALUES(upper(p_op),p_uid);
 RETURN true;
END $$;
REVOKE ALL ON vpo_stage.registration_challenges,vpo_stage.account_admin_audit FROM PUBLIC;
REVOKE ALL ON FUNCTION vpo_stage.registration_begin(uuid,text,text),vpo_stage.registration_finish(uuid,text,text),vpo_stage.account_admin_list(text),vpo_stage.account_admin_change(uuid,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA vpo_stage TO vpo_accounts;
GRANT EXECUTE ON FUNCTION vpo_stage.registration_begin(uuid,text,text),vpo_stage.registration_finish(uuid,text,text),vpo_stage.account_admin_list(text),vpo_stage.account_admin_change(uuid,text) TO vpo_accounts;
COMMIT;
