-- Apply after workflow-schema.sql, as restricted non-superuser migration owner.
BEGIN;
CREATE FUNCTION vpo_stage.demo_score_vector(b jsonb) RETURNS smallint[]
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,vpo_stage AS $$
DECLARE s smallint[];
BEGIN
 IF jsonb_typeof(b) IS DISTINCT FROM 'array' OR jsonb_array_length(b)<>5 THEN RAISE EXCEPTION 'INVALID_SCORES'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(b) AS x(v) WHERE jsonb_typeof(v)<>'number' OR v::text !~ '^[0-4]$') THEN RAISE EXCEPTION 'INVALID_SCORES'; END IF;
 SELECT array_agg(v::text::smallint ORDER BY n) INTO s FROM jsonb_array_elements(b) WITH ORDINALITY AS x(v,n);
 RETURN s;
END $$;
CREATE FUNCTION vpo_stage.demo_staff_action(op text, obj uuid, b jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
DECLARE r text; cid uuid; a vpo_stage.demo_marking_assignments%ROWTYPE; res vpo_stage.demo_results%ROWTYPE;
 o vpo_stage.demo_orders%ROWTYPE; c vpo_stage.demo_certificates%ROWTYPE; ap vpo_stage.demo_appeals%ROWTYPE;
 s smallint[]; totals integer[]; score numeric(4,1); v_reason text; award text; token text; out jsonb; ref text;
BEGIN
 SELECT role INTO r FROM vpo_stage.demo_staff WHERE login_name=session_user;
 IF r IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF jsonb_typeof(b) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF op='queue' THEN
  IF r='examiner' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('assignment_id',x.id,'case_id',x.case_id,'locked',m.assignment_id IS NOT NULL)),'[]'::jsonb) INTO out FROM vpo_stage.demo_marking_assignments x LEFT JOIN vpo_stage.demo_marks m ON m.assignment_id=x.id WHERE x.examiner=session_user;
  ELSIF r='moderator' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('case_id',z.id,'locked_marks',z.n)),'[]'::jsonb) INTO out FROM (SELECT k.id,count(m.assignment_id) n FROM vpo_stage.demo_marking_cases k JOIN vpo_stage.demo_marking_assignments x ON x.case_id=k.id LEFT JOIN vpo_stage.demo_marks m ON m.assignment_id=x.id LEFT JOIN vpo_stage.demo_results rr ON rr.case_id=k.id WHERE rr.case_id IS NULL GROUP BY k.id) z;
  ELSIF r IN ('approver','publisher') THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('case_id',k.case_id,'score',k.score,'award',k.award,'state',k.state,'reason',k.reason,'adjudicated_scores',k.adjudicated_scores)),'[]'::jsonb) INTO out FROM vpo_stage.demo_results k WHERE k.state=CASE r WHEN 'approver' THEN 'PROPOSED' ELSE 'APPROVED' END;
  ELSIF r='finance' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('order_id',k.id,'amount_units',k.amount_units,'transfer_ref',p.transfer_ref)),'[]'::jsonb) INTO out FROM vpo_stage.demo_orders k JOIN vpo_stage.demo_payment_reports p ON p.order_id=k.id WHERE k.state='REPORTED';
  ELSIF r='appeal_reviewer' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('case_id',k.case_id,'category',k.category)),'[]'::jsonb) INTO out FROM vpo_stage.demo_appeals k WHERE k.state='OPEN';
  ELSIF r='cert_officer' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('case_id',k.case_id,'award',k.award,'certificate_id',c2.id,'revoked_at',c2.revoked_at,'revocation_requested',c2.revoke_requested_by IS NOT NULL)),'[]'::jsonb) INTO out FROM vpo_stage.demo_results k LEFT JOIN vpo_stage.demo_certificates c2 ON c2.case_id=k.case_id WHERE k.state='PUBLISHED';
  ELSIF r='cert_approver' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('certificate_id',k.id,'reason',k.revoke_reason)),'[]'::jsonb) INTO out FROM vpo_stage.demo_certificates k WHERE k.revoke_requested_by IS NOT NULL AND k.revoked_at IS NULL;
  END IF;
  RETURN coalesce(out,'[]'::jsonb);
 END IF;
 IF obj IS NULL THEN RAISE EXCEPTION 'OBJECT_REQUIRED'; END IF;
 IF op IN ('read_assigned','lock_mark') THEN
  IF r<>'examiner' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO a FROM vpo_stage.demo_marking_assignments WHERE id=obj AND examiner=session_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM 1 FROM vpo_stage.demo_marking_cases WHERE id=a.case_id FOR UPDATE;
  IF op='read_assigned' THEN
   SELECT jsonb_build_object('assignment_id',a.id,'case_id',k.id,'rubric_version',k.rubric_version,'topic',t.topic_snapshot,'essay',d.body,'locked',m.assignment_id IS NOT NULL,'own_scores',m.scores) INTO out
   FROM vpo_stage.demo_marking_cases k JOIN vpo_stage.demo_attempts t ON t.id=k.attempt_id
   JOIN vpo_stage.demo_submissions sub ON sub.attempt_id=t.id JOIN vpo_stage.demo_drafts d ON d.attempt_id=t.id AND d.seq=sub.seq
   LEFT JOIN vpo_stage.demo_marks m ON m.assignment_id=a.id WHERE k.id=a.case_id;
   INSERT INTO vpo_stage.demo_workflow_audit(actor,action,object_id) VALUES(session_user,op,obj); RETURN out;
  END IF;
  IF EXISTS(SELECT 1 FROM vpo_stage.demo_results WHERE case_id=a.case_id) THEN RAISE EXCEPTION 'CASE_LOCKED'; END IF;
  s:=vpo_stage.demo_score_vector(b->'scores'); v_reason:=b->>'reason';
  IF v_reason IS NULL OR octet_length(trim(v_reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  INSERT INTO vpo_stage.demo_marks(assignment_id,scores,rationale) VALUES(obj,s,v_reason);
  out:=jsonb_build_object('locked',true,'assignment_id',obj);
 ELSIF op IN ('moderation_detail','propose','approve','publish','appeal_decide','cert_issue') THEN
  IF (op IN ('moderation_detail','propose') AND r<>'moderator') OR (op='approve' AND r<>'approver') OR (op='publish' AND r<>'publisher') OR (op='appeal_decide' AND r<>'appeal_reviewer') OR (op='cert_issue' AND r<>'cert_officer') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM 1 FROM vpo_stage.demo_marking_cases WHERE id=obj FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO res FROM vpo_stage.demo_results WHERE case_id=obj;
  IF op IN ('moderation_detail','propose') THEN
   SELECT array_agg(z.total ORDER BY z.total) INTO totals FROM (SELECT (SELECT sum(v) FROM unnest(m.scores) v)::integer total FROM vpo_stage.demo_marking_assignments x JOIN vpo_stage.demo_marks m ON m.assignment_id=x.id WHERE x.case_id=obj) z;
   IF op='moderation_detail' THEN
    SELECT jsonb_build_object('case_id',k.id,'topic',t.topic_snapshot,'essay',d.body,'marks',(SELECT coalesce(jsonb_agg(jsonb_build_object('scores',m.scores,'reason',m.rationale)),'[]'::jsonb) FROM vpo_stage.demo_marking_assignments x JOIN vpo_stage.demo_marks m ON m.assignment_id=x.id WHERE x.case_id=k.id)) INTO out
    FROM vpo_stage.demo_marking_cases k JOIN vpo_stage.demo_attempts t ON t.id=k.attempt_id JOIN vpo_stage.demo_submissions sub ON sub.attempt_id=t.id JOIN vpo_stage.demo_drafts d ON d.attempt_id=t.id AND d.seq=sub.seq WHERE k.id=obj;
    INSERT INTO vpo_stage.demo_workflow_audit(actor,action,object_id) VALUES(session_user,op,obj); RETURN out;
   END IF;
   IF res.case_id IS NOT NULL OR coalesce(cardinality(totals),0)<>2 OR (SELECT count(*) FROM vpo_stage.demo_marking_assignments WHERE case_id=obj)<>2 THEN RAISE EXCEPTION 'TWO_LOCKED_MARKS_REQUIRED'; END IF;
   v_reason:=b->>'reason'; award:=b->>'award';
   IF v_reason IS NULL OR octet_length(trim(v_reason)) NOT BETWEEN 1 AND 2000 OR award IS NULL OR award NOT IN ('NONE','FIRST','SECOND','THIRD','HONORABLE_MENTION') THEN RAISE EXCEPTION 'INVALID_PROPOSAL'; END IF;
   IF totals[2]-totals[1]>=4 THEN s:=vpo_stage.demo_score_vector(b->'adjudicated_scores'); SELECT sum(v) INTO score FROM unnest(s) v;
   ELSE IF b ? 'adjudicated_scores' THEN RAISE EXCEPTION 'NO_ADJUDICATION_NEEDED'; END IF; score:=(totals[1]+totals[2])/2.0; END IF;
   INSERT INTO vpo_stage.demo_results(case_id,score,adjudicated_scores,award,reason,moderator) VALUES(obj,score,s,award,v_reason,session_user);
   out:=jsonb_build_object('state','PROPOSED','score',score,'award',award);
  ELSIF op='approve' THEN
   IF res.state IS DISTINCT FROM 'PROPOSED' OR res.moderator=session_user THEN RAISE EXCEPTION 'NOT_APPROVABLE'; END IF;
   UPDATE vpo_stage.demo_results SET state='APPROVED',approver=session_user WHERE case_id=obj;
   out:=jsonb_build_object('state','APPROVED');
  ELSIF op='publish' THEN
   IF res.state IS DISTINCT FROM 'APPROVED' OR res.moderator=session_user OR res.approver=session_user THEN RAISE EXCEPTION 'NOT_PUBLISHABLE'; END IF;
   UPDATE vpo_stage.demo_results SET state='PUBLISHED',publisher=session_user,published_at=clock_timestamp() WHERE case_id=obj;
   out:=jsonb_build_object('state','PUBLISHED','visibility','STUDENT_ONLY_DEMO');
  ELSIF op='appeal_decide' THEN
   SELECT * INTO ap FROM vpo_stage.demo_appeals WHERE case_id=obj;
   v_reason:=b->>'reason';
   IF ap.state IS DISTINCT FROM 'OPEN' OR res.moderator=session_user OR res.approver=session_user OR res.publisher=session_user OR v_reason IS NULL OR octet_length(trim(v_reason)) NOT BETWEEN 1 AND 2000 OR coalesce(b->>'decision','') NOT IN ('DISMISSED','REVIEW_REQUIRED') THEN RAISE EXCEPTION 'INVALID_APPEAL_DECISION'; END IF;
   UPDATE vpo_stage.demo_appeals SET state=b->>'decision',reviewer=session_user,reason=v_reason WHERE case_id=obj;
   out:=jsonb_build_object('appeal_state',b->>'decision','score_changed',false);
  ELSE
   IF res.state IS DISTINCT FROM 'PUBLISHED' OR res.award='NONE' OR EXISTS(SELECT 1 FROM vpo_stage.demo_appeals WHERE case_id=obj AND state IN ('OPEN','REVIEW_REQUIRED')) THEN RAISE EXCEPTION 'CERTIFICATE_NOT_ALLOWED'; END IF;
   token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
   INSERT INTO vpo_stage.demo_certificates(case_id,token_hash,officer) VALUES(obj,sha256(convert_to(token,'UTF8')),session_user) RETURNING * INTO c;
   out:=jsonb_build_object('certificate_id',c.id,'verification_token',token,'verification_path','/public/certificates/'||token,'label','DEMO ONLY');
  END IF;
 ELSIF op='reconcile' THEN
  IF r<>'finance' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO o FROM vpo_stage.demo_orders WHERE id=obj FOR UPDATE;
  IF o.state IS DISTINCT FROM 'REPORTED' THEN RAISE EXCEPTION 'NOT_RECONCILABLE'; END IF;
  SELECT p.transfer_ref INTO ref FROM vpo_stage.demo_payment_reports p JOIN vpo_stage.demo_statement_lines l ON l.transfer_ref=p.transfer_ref AND l.order_id=p.order_id AND l.amount_units=o.amount_units WHERE p.order_id=obj;
  IF ref IS NULL THEN RAISE EXCEPTION 'NO_MATCHING_STATEMENT'; END IF;
  INSERT INTO vpo_stage.demo_reconciliations(order_id,transfer_ref,officer) VALUES(obj,ref,session_user);
  UPDATE vpo_stage.demo_orders SET state='PAID' WHERE id=obj;
  out:=jsonb_build_object('state','PAID','mode','synthetic');
 ELSIF op IN ('cert_revoke_request','cert_revoke_approve') THEN
  IF (op='cert_revoke_request' AND r<>'cert_officer') OR (op='cert_revoke_approve' AND r<>'cert_approver') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO c FROM vpo_stage.demo_certificates WHERE id=obj FOR UPDATE;
  IF NOT FOUND OR c.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND_OR_REVOKED'; END IF;
  IF op='cert_revoke_request' THEN
   v_reason:=b->>'reason';
   IF c.revoke_requested_by IS NOT NULL OR v_reason IS NULL OR octet_length(trim(v_reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
   UPDATE vpo_stage.demo_certificates SET revoke_requested_by=session_user,revoke_reason=v_reason WHERE id=obj;
   out:=jsonb_build_object('state','REVOCATION_PENDING');
  ELSE
   IF c.revoke_requested_by IS NULL OR c.revoke_requested_by=session_user THEN RAISE EXCEPTION 'INDEPENDENT_APPROVAL_REQUIRED'; END IF;
   UPDATE vpo_stage.demo_certificates SET revoked_by=session_user,revoked_at=clock_timestamp() WHERE id=obj;
   out:=jsonb_build_object('state','REVOKED');
  END IF;
 ELSE RAISE EXCEPTION 'UNKNOWN_OPERATION'; END IF;
 INSERT INTO vpo_stage.demo_workflow_audit(actor,action,object_id) VALUES(session_user,op,obj);
 RETURN out;
END $$;

-- Only authenticated student API runtime may call this routine. The caller MUST bind user ID from session.
CREATE FUNCTION vpo_stage.demo_student_action(uid uuid, op text, obj uuid, b jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
DECLARE out jsonb; o vpo_stage.demo_orders%ROWTYPE; ref text; category text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vpo_stage.users u JOIN vpo_stage.role_grants g ON g.user_id=u.id WHERE u.id=uid AND u.status='ACTIVE' AND g.role='student' AND g.revoked_at IS NULL) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF op='results' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('case_id',r.case_id,'score',r.score,'award',r.award,'rubric_version',k.rubric_version,'published_at',r.published_at,'appeal_state',ap.state)),'[]'::jsonb) INTO out FROM vpo_stage.demo_results r JOIN vpo_stage.demo_marking_cases k ON k.id=r.case_id JOIN vpo_stage.demo_attempts a ON a.id=k.attempt_id LEFT JOIN vpo_stage.demo_appeals ap ON ap.case_id=k.id WHERE a.user_id=uid AND r.state='PUBLISHED'; RETURN out;
 ELSIF op='orders' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'amount_units',amount_units,'state',state,'mode','synthetic')),'[]'::jsonb) INTO out FROM vpo_stage.demo_orders WHERE user_id=uid; RETURN out;
 ELSIF op='report' THEN
  SELECT * INTO o FROM vpo_stage.demo_orders WHERE id=obj AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  ref:=b->>'transfer_ref';
  IF ref IS NULL OR ref !~ '^DEMO-[A-Z0-9]{8,32}$' OR o.state<>'UNPAID' THEN RAISE EXCEPTION 'INVALID_REPORT'; END IF;
  INSERT INTO vpo_stage.demo_payment_reports(order_id,transfer_ref) VALUES(obj,ref);
  UPDATE vpo_stage.demo_orders SET state='REPORTED' WHERE id=obj;
  out:=jsonb_build_object('state','REPORTED');
 ELSIF op='appeal' THEN
  PERFORM 1 FROM vpo_stage.demo_marking_cases k JOIN vpo_stage.demo_results r ON r.case_id=k.id JOIN vpo_stage.demo_attempts a ON a.id=k.attempt_id WHERE k.id=obj AND a.user_id=uid AND r.state='PUBLISHED' FOR UPDATE OF k;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  category:=b->>'category'; IF category IS NULL OR category NOT IN ('SCORING','PROCESS','TECHNICAL') THEN RAISE EXCEPTION 'INVALID_CATEGORY'; END IF;
  INSERT INTO vpo_stage.demo_appeals(case_id,category) VALUES(obj,category);
  out:=jsonb_build_object('state','OPEN');
 ELSE RAISE EXCEPTION 'UNKNOWN_OPERATION'; END IF;
 INSERT INTO vpo_stage.demo_workflow_audit(actor,action,object_id) VALUES(uid::text,op,obj);
 RETURN out;
END $$;

CREATE FUNCTION vpo_stage.demo_verify_certificate(token text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $$
 SELECT jsonb_build_object('mode','synthetic','status',CASE WHEN c.revoked_at IS NOT NULL THEN 'REVOKED' WHEN c.revoke_requested_by IS NOT NULL OR ap.state IN ('OPEN','REVIEW_REQUIRED') THEN 'ON_HOLD' ELSE 'VALID_DEMO' END,'award',CASE WHEN c.revoked_at IS NULL AND c.revoke_requested_by IS NULL AND (ap.state IS NULL OR ap.state='DISMISSED') THEN r.award ELSE NULL END,'issued_at',c.issued_at)
 FROM vpo_stage.demo_certificates c JOIN vpo_stage.demo_results r ON r.case_id=c.case_id LEFT JOIN vpo_stage.demo_appeals ap ON ap.case_id=c.case_id
 WHERE token ~ '^[a-f0-9]{64}$' AND c.token_hash=sha256(convert_to(token,'UTF8')) AND r.state='PUBLISHED'
$$;
REVOKE ALL ON FUNCTION vpo_stage.demo_score_vector(jsonb),vpo_stage.demo_staff_action(text,uuid,jsonb),vpo_stage.demo_student_action(uuid,text,uuid,jsonb),vpo_stage.demo_verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vpo_stage.demo_staff_action(text,uuid,jsonb) TO vpo_demo_staff;
GRANT EXECUTE ON FUNCTION vpo_stage.demo_student_action(uuid,text,uuid,jsonb),vpo_stage.demo_verify_certificate(text) TO vpo_runtime;
COMMIT;