-- V6.3 synthetic admin operations. No real records. Migration owner only.
BEGIN;
ALTER TABLE vpo_stage.account_admin_audit ADD COLUMN round_id uuid REFERENCES vpo_stage.demo_rounds(id);
CREATE FUNCTION vpo_stage.admin_overview() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $overview$
 SELECT jsonb_build_object(
 'users',(SELECT count(*) FROM vpo_stage.users WHERE deleted_at IS NULL),
 'verified',(SELECT count(*) FROM vpo_stage.users WHERE deleted_at IS NULL AND email_verified_at IS NOT NULL),
 'suspended',(SELECT count(*) FROM vpo_stage.users WHERE deleted_at IS NULL AND status='SUSPENDED'),
 'rounds',(SELECT count(*) FROM vpo_stage.demo_rounds),
 'enrolments',(SELECT count(*) FROM vpo_stage.demo_enrolments),
 'active_attempts',(SELECT count(*) FROM vpo_stage.demo_attempts WHERE state='ACTIVE'),
 'submitted',(SELECT count(*) FROM vpo_stage.demo_submissions),
 'academy_enrolments',(SELECT count(*) FROM vpo_stage.academy_enrolments))
$overview$;
CREATE FUNCTION vpo_stage.admin_rounds() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $rounds$
 SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.opens_at DESC,z.id),'[]'::jsonb) FROM
 (SELECT r.id,r.label,r.opens_at,r.closes_at,r.duration_seconds,
  (SELECT count(*) FROM vpo_stage.demo_enrolments e WHERE e.round_id=r.id) AS enrolments,
  (SELECT count(*) FROM vpo_stage.demo_attempts a WHERE a.round_id=r.id AND a.state='ACTIVE') AS active_attempts,
  (SELECT count(*) FROM vpo_stage.demo_attempts a WHERE a.round_id=r.id AND a.state<>'ACTIVE') AS final_attempts
  FROM vpo_stage.demo_rounds r ORDER BY r.opens_at DESC,r.id LIMIT 100) z
$rounds$;
CREATE FUNCTION vpo_stage.admin_create_round(p_label text,p_open timestamptz,p_close timestamptz,p_duration integer,p_topic text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $create$
DECLARE rid uuid; n timestamptz:=clock_timestamp();
BEGIN
 IF p_label IS NULL OR p_label NOT LIKE 'DEMO %' OR length(p_label)>120 OR length(trim(p_label))<6
 OR p_open IS NULL OR p_close IS NULL OR p_open<n-interval '5 minutes' OR p_open>n+interval '1 year'
 OR p_close<=n OR p_close<=p_open OR p_close>p_open+interval '7 days'
 OR p_duration IS NULL OR p_duration NOT BETWEEN 60 AND 14400
 OR p_close-p_open<make_interval(secs=>p_duration)
 OR p_topic IS NULL OR octet_length(p_topic) NOT BETWEEN 1 AND 8000 OR length(trim(p_topic))=0 THEN RETURN NULL; END IF;
 INSERT INTO vpo_stage.demo_rounds(label,opens_at,closes_at,duration_seconds,topic)
 VALUES(p_label,p_open,p_close,p_duration,p_topic) RETURNING id INTO rid;
 INSERT INTO vpo_stage.account_admin_audit(action,round_id) VALUES('ROUND_CREATED',rid);
 RETURN rid;
END $create$;
-- No withdrawal, editing or cancellation until separate rules and UAT.
-- Explicit enrolment for active verified accounts, before close; no self-enrolment.
CREATE FUNCTION vpo_stage.admin_enrol(p_uid uuid,p_rid uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $enrol$
DECLARE u vpo_stage.users%ROWTYPE; r vpo_stage.demo_rounds%ROWTYPE;
BEGIN
 SELECT * INTO u FROM vpo_stage.users WHERE id=p_uid FOR UPDATE;
 IF NOT FOUND OR u.status<>'ACTIVE' OR u.deleted_at IS NOT NULL OR u.email_verified_at IS NULL
 OR NOT EXISTS(SELECT 1 FROM vpo_stage.role_grants WHERE user_id=p_uid AND role='student' AND revoked_at IS NULL) THEN RETURN 'REFUSED'; END IF;
 SELECT * INTO r FROM vpo_stage.demo_rounds WHERE id=p_rid FOR SHARE;
 IF NOT FOUND OR r.closes_at<=clock_timestamp() THEN RETURN 'REFUSED'; END IF;
 INSERT INTO vpo_stage.demo_enrolments(round_id,user_id) VALUES(p_rid,p_uid) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'EXISTS'; END IF;
 INSERT INTO vpo_stage.account_admin_audit(action,user_id,round_id) VALUES('ENROLLED',p_uid,p_rid);
 RETURN 'CREATED';
END $enrol$;
CREATE FUNCTION vpo_stage.admin_audit() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $audit$
 SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.id DESC),'[]'::jsonb) FROM
 (SELECT a.id,a.action,a.created_at,a.user_id,a.round_id,u.email,r.label AS round_label
 FROM vpo_stage.account_admin_audit a LEFT JOIN vpo_stage.users u ON u.id=a.user_id
 LEFT JOIN vpo_stage.demo_rounds r ON r.id=a.round_id ORDER BY a.id DESC LIMIT 100) z
$audit$;
CREATE OR REPLACE FUNCTION vpo_stage.account_admin_change(p_uid uuid,p_op text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $change$
DECLARE u vpo_stage.users%ROWTYPE;
BEGIN
 SELECT * INTO u FROM vpo_stage.users WHERE id=p_uid FOR UPDATE;
 IF NOT FOUND OR u.deleted_at IS NOT NULL OR p_op IS NULL OR p_op NOT IN ('suspend','activate','delete') THEN RETURN false; END IF;
 IF p_op IN ('suspend','delete') AND EXISTS(SELECT 1 FROM vpo_stage.demo_attempts WHERE user_id=p_uid AND state='ACTIVE') THEN RETURN false; END IF;
 IF p_op='activate' THEN UPDATE vpo_stage.users SET status='ACTIVE' WHERE id=p_uid;
 ELSIF p_op='suspend' THEN UPDATE vpo_stage.users SET status='SUSPENDED' WHERE id=p_uid;
 ELSE UPDATE vpo_stage.users SET status='SUSPENDED',deleted_at=clock_timestamp() WHERE id=p_uid; END IF;
 INSERT INTO vpo_stage.account_admin_audit(action,user_id) VALUES(upper(p_op),p_uid);
 RETURN true;
END $change$;
REVOKE ALL ON FUNCTION vpo_stage.admin_overview(),vpo_stage.admin_rounds(),vpo_stage.admin_create_round(text,timestamptz,timestamptz,integer,text),vpo_stage.admin_enrol(uuid,uuid),vpo_stage.admin_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vpo_stage.admin_overview(),vpo_stage.admin_rounds(),vpo_stage.admin_create_round(text,timestamptz,timestamptz,integer,text),vpo_stage.admin_enrol(uuid,uuid),vpo_stage.admin_audit() TO vpo_accounts;
COMMIT;
