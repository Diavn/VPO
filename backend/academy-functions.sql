-- V4.7 routines. Apply after academy-schema.sql as restricted migration owner.
BEGIN;
CREATE FUNCTION vpo_stage.academy_student(p_uid uuid,p_op text,p_id uuid,p_body jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
DECLARE e vpo_stage.academy_enrolments%ROWTYPE; t vpo_stage.academy_tasks%ROWTYPE; s vpo_stage.academy_submissions%ROWTYPE;
 v_stage text; v_ordinal integer; v_op uuid; v_essay text; v_note text; v_condition text; v_result jsonb; v_previous text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vpo_stage.users u JOIN vpo_stage.role_grants g ON g.user_id=u.id WHERE u.id=p_uid AND u.status='ACTIVE' AND g.role='student' AND g.revoked_at IS NULL) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_op='courses' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('enrolment_id',en.id,'course_id',c.id,'code',c.code,'title',c.title,'version',c.version,'rubric_version',c.rubric_version) ORDER BY c.code),'[]'::jsonb) INTO v_result
  FROM vpo_stage.academy_enrolments en JOIN vpo_stage.academy_courses c ON c.id=en.course_id WHERE en.user_id=p_uid;
  RETURN v_result;
 END IF;
 SELECT * INTO e FROM vpo_stage.academy_enrolments WHERE id=p_id AND user_id=p_uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_op='portfolio' THEN
  SELECT jsonb_build_object('enrolment_id',e.id,'course_id',c.id,'title',c.title,'version',c.version,'rubric_version',c.rubric_version,
   'lessons',(SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',l.ordinal,'title',l.title,'objective',l.objective,'lesson_text',l.lesson_text,'practice',l.practice,'completed',ac.enrolment_id IS NOT NULL) ORDER BY l.ordinal),'[]'::jsonb)
      FROM vpo_stage.academy_lessons l LEFT JOIN vpo_stage.academy_completion ac ON ac.enrolment_id=e.id AND ac.ordinal=l.ordinal WHERE l.course_id=e.course_id),
   'tasks',(SELECT coalesce(jsonb_agg(jsonb_build_object('stage',at.stage,'prompt',CASE WHEN at.stage='BASELINE' OR EXISTS(SELECT 1 FROM vpo_stage.academy_submissions prev JOIN vpo_stage.academy_feedback f ON f.submission_id=prev.id WHERE prev.enrolment_id=e.id AND prev.stage=CASE at.stage WHEN 'REVISION' THEN 'BASELINE' ELSE 'REVISION' END) THEN at.prompt ELSE NULL END,'condition',at.condition) ORDER BY CASE at.stage WHEN 'BASELINE' THEN 1 WHEN 'REVISION' THEN 2 ELSE 3 END),'[]'::jsonb) FROM vpo_stage.academy_tasks at WHERE at.course_id=e.course_id),
   'submissions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',sub.id,'stage',sub.stage,'essay',sub.essay,'condition',sub.declared_condition,'revision_note',sub.revision_note,'submitted_at',sub.submitted_at,'scores',f.scores,'evidence',f.evidence,'next_action',f.next_action,'assessed_at',f.assessed_at) ORDER BY CASE sub.stage WHEN 'BASELINE' THEN 1 WHEN 'REVISION' THEN 2 ELSE 3 END),'[]'::jsonb) FROM vpo_stage.academy_submissions sub LEFT JOIN vpo_stage.academy_feedback f ON f.submission_id=sub.id WHERE sub.enrolment_id=e.id)
  ) INTO v_result FROM vpo_stage.academy_courses c WHERE c.id=e.course_id;
  RETURN v_result;
 ELSIF p_op='complete' THEN
  IF jsonb_typeof(p_body->'ordinal') IS DISTINCT FROM 'number' OR (p_body->>'ordinal') !~ '^[1-6]$' THEN RAISE EXCEPTION 'INVALID_ORDINAL'; END IF;
  v_ordinal:=(p_body->>'ordinal')::integer;
  IF NOT EXISTS(SELECT 1 FROM vpo_stage.academy_lessons l WHERE l.course_id=e.course_id AND l.ordinal=v_ordinal) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  INSERT INTO vpo_stage.academy_completion(enrolment_id,course_id,ordinal) VALUES(e.id,e.course_id,v_ordinal) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('completed',true,'ordinal',v_ordinal,'evidence_type','SELF_REPORTED_COMPLETION');
 ELSIF p_op='submit' THEN
  v_stage:=p_body->>'stage'; v_op:=(p_body->>'op_id')::uuid; v_essay:=p_body->>'essay'; v_note:=p_body->>'revision_note'; v_condition:=p_body->>'condition';
  IF v_op IS NULL OR v_stage IS NULL OR v_essay IS NULL OR trim(v_essay)='' OR octet_length(v_essay)>40000 OR v_note IS NULL OR octet_length(v_note)>2000 OR v_condition IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO t FROM vpo_stage.academy_tasks WHERE course_id=e.course_id AND stage=v_stage;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF (v_stage='REVISION' AND (trim(v_note)='' OR v_condition NOT IN ('FEEDBACK_SUPPORTED','OTHER_DECLARED'))) OR (v_stage<>'REVISION' AND (v_note<>'' OR v_condition NOT IN ('INDEPENDENT_DECLARED','OTHER_DECLARED'))) THEN RAISE EXCEPTION 'INVALID_CONDITION'; END IF;
  SELECT * INTO s FROM vpo_stage.academy_submissions WHERE enrolment_id=e.id AND op_id=v_op;
  IF FOUND THEN
   IF s.stage<>v_stage OR s.essay<>v_essay OR s.declared_condition<>v_condition OR s.revision_note<>v_note THEN RAISE EXCEPTION 'OP_CONFLICT'; END IF;
   RETURN jsonb_build_object('id',s.id,'stage',s.stage,'replayed',true);
  END IF;
  IF EXISTS(SELECT 1 FROM vpo_stage.academy_submissions x WHERE x.enrolment_id=e.id AND x.stage=v_stage) THEN RAISE EXCEPTION 'ALREADY_SUBMITTED'; END IF;
  IF v_stage<>'BASELINE' THEN
   v_previous:=CASE v_stage WHEN 'REVISION' THEN 'BASELINE' ELSE 'REVISION' END;
   IF NOT EXISTS(SELECT 1 FROM vpo_stage.academy_submissions prev JOIN vpo_stage.academy_feedback f ON f.submission_id=prev.id WHERE prev.enrolment_id=e.id AND prev.stage=v_previous) THEN RAISE EXCEPTION 'STAGE_LOCKED'; END IF;
  END IF;
  INSERT INTO vpo_stage.academy_submissions(enrolment_id,course_id,stage,op_id,essay,declared_condition,revision_note) VALUES(e.id,e.course_id,v_stage,v_op,v_essay,v_condition,v_note) RETURNING * INTO s;
  INSERT INTO vpo_stage.demo_workflow_audit(actor,action,object_id) VALUES(p_uid::text,'ACADEMY_SUBMIT',s.id);
  RETURN jsonb_build_object('id',s.id,'stage',s.stage,'replayed',false);
 ELSE RAISE EXCEPTION 'UNKNOWN_OPERATION'; END IF;
END $$;

CREATE FUNCTION vpo_stage.academy_mentor(p_op text,p_id uuid,p_body jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
DECLARE e vpo_stage.academy_enrolments%ROWTYPE; s vpo_stage.academy_submissions%ROWTYPE; v_result jsonb; v_scores smallint[]; v_evidence text; v_action text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vpo_stage.academy_mentors WHERE login_name=session_user) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_op='queue' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('submission_id',sub.id,'enrolment_id',en.id,'course',c.title,'stage',sub.stage,'condition',sub.declared_condition,'assessed',f.submission_id IS NOT NULL) ORDER BY sub.submitted_at),'[]'::jsonb)
   INTO v_result FROM vpo_stage.academy_enrolments en JOIN vpo_stage.academy_courses c ON c.id=en.course_id JOIN vpo_stage.academy_submissions sub ON sub.enrolment_id=en.id LEFT JOIN vpo_stage.academy_feedback f ON f.submission_id=sub.id WHERE en.mentor=session_user;
  RETURN v_result;
 END IF;
 SELECT en.* INTO e FROM vpo_stage.academy_enrolments en JOIN vpo_stage.academy_submissions sub ON sub.enrolment_id=en.id WHERE sub.id=p_id AND en.mentor=session_user FOR UPDATE OF en;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO s FROM vpo_stage.academy_submissions WHERE id=p_id;
 IF p_op='read' THEN
  SELECT jsonb_build_object('submission_id',s.id,'stage',s.stage,'condition',s.declared_condition,'essay',s.essay,'revision_note',s.revision_note,'prompt',t.prompt,'rubric_version',c.rubric_version,'feedback',CASE WHEN f.submission_id IS NULL THEN NULL ELSE jsonb_build_object('scores',f.scores,'evidence',f.evidence,'next_action',f.next_action) END) INTO v_result
   FROM vpo_stage.academy_tasks t JOIN vpo_stage.academy_courses c ON c.id=t.course_id LEFT JOIN vpo_stage.academy_feedback f ON f.submission_id=s.id WHERE t.course_id=e.course_id AND t.stage=s.stage;
  INSERT INTO vpo_stage.demo_workflow_audit(actor,action,object_id) VALUES(session_user,'ACADEMY_READ',s.id);
  RETURN v_result;
 ELSIF p_op='feedback' THEN
  v_scores:=vpo_stage.demo_score_vector(p_body->'scores'); v_evidence:=p_body->>'evidence'; v_action:=p_body->>'next_action';
  IF v_scores IS NULL OR v_evidence IS NULL OR v_action IS NULL OR trim(v_evidence)='' OR trim(v_action)='' OR octet_length(v_evidence)>2000 OR octet_length(v_action)>2000 THEN RAISE EXCEPTION 'INVALID_FEEDBACK'; END IF;
  INSERT INTO vpo_stage.academy_feedback(submission_id,mentor,scores,evidence,next_action) VALUES(s.id,session_user,v_scores,v_evidence,v_action);
  INSERT INTO vpo_stage.demo_workflow_audit(actor,action,object_id) VALUES(session_user,'ACADEMY_FEEDBACK',s.id);
  RETURN jsonb_build_object('submission_id',s.id,'assessed',true);
 ELSE RAISE EXCEPTION 'UNKNOWN_OPERATION'; END IF;
END $$;
REVOKE ALL ON FUNCTION vpo_stage.academy_student(uuid,text,uuid,jsonb),vpo_stage.academy_mentor(text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vpo_stage.academy_student(uuid,text,uuid,jsonb) TO vpo_runtime;
GRANT EXECUTE ON FUNCTION vpo_stage.academy_mentor(text,uuid,jsonb) TO vpo_demo_mentor;
COMMIT;