-- Synthetic question bank and Academy enrolment. Migration owner only.
BEGIN;
CREATE TABLE vpo_stage.question_versions(
 id uuid PRIMARY KEY, code text NOT NULL CHECK(code ~ '^DEMO-[A-Z0-9-]{1,60}$'),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 topic text NOT NULL CHECK(octet_length(topic) BETWEEN 1 AND 8000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(code,version)
);
ALTER TABLE vpo_stage.demo_rounds ADD COLUMN question_version_id uuid REFERENCES vpo_stage.question_versions(id);
ALTER TABLE vpo_stage.account_admin_audit ADD COLUMN question_version_id uuid REFERENCES vpo_stage.question_versions(id), ADD COLUMN course_id uuid REFERENCES vpo_stage.academy_courses(id);
CREATE FUNCTION vpo_stage.question_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,vpo_stage AS $immut$
BEGIN RAISE EXCEPTION 'QUESTION_VERSION_IMMUTABLE' USING ERRCODE='23514'; END $immut$;
CREATE TRIGGER question_version_immutable BEFORE UPDATE OR DELETE ON vpo_stage.question_versions FOR EACH ROW EXECUTE FUNCTION vpo_stage.question_immutable();
CREATE FUNCTION vpo_stage.admin_question_list() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $list$
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.code,x.version DESC),'[]'::jsonb)
 FROM (SELECT id,code,version,topic FROM vpo_stage.question_versions ORDER BY created_at DESC,id LIMIT 100) x
$list$;
CREATE FUNCTION vpo_stage.admin_question_add(p_id uuid,p_code text,p_version integer,p_topic text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $add$
DECLARE v vpo_stage.question_versions%ROWTYPE;
BEGIN
 IF p_id IS NULL OR p_code IS NULL OR p_code !~ '^DEMO-[A-Z0-9-]{1,60}$' OR p_version IS NULL OR p_version NOT BETWEEN 1 AND 1000 OR p_topic IS NULL OR length(trim(p_topic))=0 OR octet_length(p_topic)>8000 THEN RETURN 'INVALID'; END IF;
 INSERT INTO vpo_stage.question_versions(id,code,version,topic) VALUES(p_id,p_code,p_version,p_topic) ON CONFLICT DO NOTHING;
 IF FOUND THEN INSERT INTO vpo_stage.account_admin_audit(action,question_version_id) VALUES('QUESTION_CREATED',p_id); RETURN 'CREATED'; END IF;
 SELECT * INTO v FROM vpo_stage.question_versions WHERE id=p_id;
 IF FOUND AND ROW(v.code,v.version,v.topic) IS NOT DISTINCT FROM ROW(p_code,p_version,p_topic) THEN RETURN 'REPLAY'; END IF;
 RETURN 'CONFLICT';
END $add$;
CREATE FUNCTION vpo_stage.admin_round_from_question(p_op uuid,p_label text,p_open timestamptz,p_close timestamptz,p_duration integer,p_question uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $round$
DECLARE q vpo_stage.question_versions%ROWTYPE; prior vpo_stage.demo_rounds%ROWTYPE; result jsonb;
BEGIN
 IF p_op IS NULL OR p_question IS NULL THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_op::text,648));
 SELECT * INTO q FROM vpo_stage.question_versions WHERE id=p_question;
 IF NOT FOUND THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 SELECT * INTO prior FROM vpo_stage.demo_rounds WHERE creation_op=p_op;
 IF FOUND AND prior.question_version_id IS DISTINCT FROM p_question THEN RETURN jsonb_build_object('result','CONFLICT'); END IF;
 result:=vpo_stage.admin_create_round(p_op,p_label,p_open,p_close,p_duration,q.topic);
 IF result->>'result'='CREATED' THEN
 UPDATE vpo_stage.demo_rounds SET question_version_id=p_question WHERE id=(result->>'id')::uuid;
 UPDATE vpo_stage.account_admin_audit SET question_version_id=p_question WHERE action='ROUND_CREATED' AND round_id=(result->>'id')::uuid;
 END IF;
 RETURN result;
END $round$;
CREATE FUNCTION vpo_stage.admin_academy_catalog() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $catalog$
 SELECT jsonb_build_object('courses',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT id,code,title,version FROM vpo_stage.academy_courses ORDER BY code LIMIT 100) x),'[]'::jsonb),'mentors',coalesce((SELECT jsonb_agg(login_name::text ORDER BY login_name) FROM vpo_stage.academy_mentors),'[]'::jsonb))
$catalog$;
CREATE FUNCTION vpo_stage.admin_academy_enrol(p_uid uuid,p_course uuid,p_mentor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $enrol$
DECLARE u vpo_stage.users%ROWTYPE; v vpo_stage.academy_enrolments%ROWTYPE; eid uuid;
BEGIN
 SELECT * INTO u FROM vpo_stage.users WHERE id=p_uid FOR UPDATE;
 IF NOT FOUND OR u.status<>'ACTIVE' OR u.deleted_at IS NOT NULL OR u.email_verified_at IS NULL THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 PERFORM 1 FROM vpo_stage.role_grants WHERE user_id=p_uid AND role='student' AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM vpo_stage.academy_courses WHERE id=p_course) OR NOT EXISTS(SELECT 1 FROM vpo_stage.academy_mentors WHERE login_name::text=p_mentor) THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 INSERT INTO vpo_stage.academy_enrolments(course_id,user_id,mentor) VALUES(p_course,p_uid,p_mentor::name) ON CONFLICT(course_id,user_id) DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN
 SELECT * INTO v FROM vpo_stage.academy_enrolments WHERE course_id=p_course AND user_id=p_uid;
 IF v.mentor::text IS DISTINCT FROM p_mentor THEN RETURN jsonb_build_object('result','CONFLICT'); END IF;
 RETURN jsonb_build_object('result','EXISTS','id',v.id);
 END IF;
 INSERT INTO vpo_stage.account_admin_audit(action,user_id,course_id) VALUES('ACADEMY_ENROLLED',p_uid,p_course);
 RETURN jsonb_build_object('result','CREATED','id',eid);
END $enrol$;
CREATE OR REPLACE FUNCTION vpo_stage.admin_audit() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $audit$
 SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.id DESC),'[]'::jsonb) FROM
 (SELECT a.id,a.action,a.created_at,a.user_id,a.round_id,u.email,r.label AS round_label,a.question_version_id,q.code AS question_code,q.version AS question_version,a.course_id,c.title AS course_title
 FROM vpo_stage.account_admin_audit a LEFT JOIN vpo_stage.users u ON u.id=a.user_id
 LEFT JOIN vpo_stage.demo_rounds r ON r.id=a.round_id LEFT JOIN vpo_stage.question_versions q ON q.id=a.question_version_id
 LEFT JOIN vpo_stage.academy_courses c ON c.id=a.course_id ORDER BY a.id DESC LIMIT 100) z
$audit$;
REVOKE ALL ON vpo_stage.question_versions FROM PUBLIC;
REVOKE ALL ON FUNCTION vpo_stage.question_immutable(),vpo_stage.admin_question_list(),vpo_stage.admin_question_add(uuid,text,integer,text),vpo_stage.admin_round_from_question(uuid,text,timestamptz,timestamptz,integer,uuid),vpo_stage.admin_academy_catalog(),vpo_stage.admin_academy_enrol(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vpo_stage.admin_question_list(),vpo_stage.admin_question_add(uuid,text,integer,text),vpo_stage.admin_round_from_question(uuid,text,timestamptz,timestamptz,integer,uuid),vpo_stage.admin_academy_catalog(),vpo_stage.admin_academy_enrol(uuid,uuid,text) TO vpo_accounts;
COMMIT;
