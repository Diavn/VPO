-- V4.6 synthetic staging only; apply after V4.4 and exam-schema.sql as migration owner.
-- DBA must create NOLOGIN vpo_demo_staff and distinct LOGIN roles before granting membership.
BEGIN;
CREATE TABLE vpo_stage.demo_staff (
 login_name name PRIMARY KEY,
 role text NOT NULL CHECK(role IN ('examiner','moderator','approver','publisher','finance','appeal_reviewer','cert_officer','cert_approver'))
);
CREATE TABLE vpo_stage.demo_marking_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL UNIQUE REFERENCES vpo_stage.demo_submissions(attempt_id),
 rubric_version text NOT NULL DEFAULT 'DEMO-R1' CHECK(rubric_version='DEMO-R1')
);
CREATE TABLE vpo_stage.demo_marking_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES vpo_stage.demo_marking_cases(id),
 examiner name NOT NULL REFERENCES vpo_stage.demo_staff(login_name),
 UNIQUE(case_id,examiner)
);
CREATE TABLE vpo_stage.demo_marks (
 assignment_id uuid PRIMARY KEY REFERENCES vpo_stage.demo_marking_assignments(id),
 scores smallint[] NOT NULL CHECK(cardinality(scores)=5 AND array_ndims(scores)=1 AND array_position(scores,NULL) IS NULL AND 0<=ALL(scores) AND 4>=ALL(scores)),
 rationale text NOT NULL CHECK(octet_length(rationale) BETWEEN 1 AND 2000),
 locked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE vpo_stage.demo_results (
 case_id uuid PRIMARY KEY REFERENCES vpo_stage.demo_marking_cases(id),
 score numeric(4,1) NOT NULL CHECK(score BETWEEN 0 AND 20),
 adjudicated_scores smallint[] CHECK(adjudicated_scores IS NULL OR (cardinality(adjudicated_scores)=5 AND array_ndims(adjudicated_scores)=1 AND array_position(adjudicated_scores,NULL) IS NULL AND 0<=ALL(adjudicated_scores) AND 4>=ALL(adjudicated_scores))),
 award text NOT NULL CHECK(award IN ('NONE','FIRST','SECOND','THIRD','HONORABLE_MENTION')),
 reason text NOT NULL CHECK(octet_length(reason) BETWEEN 1 AND 2000),
 moderator name NOT NULL REFERENCES vpo_stage.demo_staff(login_name),
 approver name REFERENCES vpo_stage.demo_staff(login_name),
 publisher name REFERENCES vpo_stage.demo_staff(login_name),
 state text NOT NULL DEFAULT 'PROPOSED' CHECK(state IN ('PROPOSED','APPROVED','PUBLISHED')),
 published_at timestamptz,
 CHECK(approver IS NULL OR moderator<>approver),
 CHECK(publisher IS NULL OR (publisher<>moderator AND publisher<>approver)),
 CHECK((state='PROPOSED' AND approver IS NULL AND publisher IS NULL AND published_at IS NULL) OR
       (state='APPROVED' AND approver IS NOT NULL AND publisher IS NULL AND published_at IS NULL) OR
       (state='PUBLISHED' AND approver IS NOT NULL AND publisher IS NOT NULL AND published_at IS NOT NULL))
);
CREATE TABLE vpo_stage.demo_appeals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL UNIQUE REFERENCES vpo_stage.demo_results(case_id),
 category text NOT NULL CHECK(category IN ('SCORING','PROCESS','TECHNICAL')),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','DISMISSED','REVIEW_REQUIRED')),
 reviewer name REFERENCES vpo_stage.demo_staff(login_name),
 reason text, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE vpo_stage.demo_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), round_id uuid NOT NULL, user_id uuid NOT NULL,
 amount_units integer NOT NULL CHECK(amount_units>0 AND amount_units<=1000000),
 state text NOT NULL DEFAULT 'UNPAID' CHECK(state IN ('UNPAID','REPORTED','PAID')),
 UNIQUE(round_id,user_id), FOREIGN KEY(round_id,user_id) REFERENCES vpo_stage.demo_enrolments(round_id,user_id)
);
CREATE TABLE vpo_stage.demo_payment_reports (
 order_id uuid PRIMARY KEY REFERENCES vpo_stage.demo_orders(id),
 transfer_ref text UNIQUE NOT NULL CHECK(transfer_ref ~ '^DEMO-[A-Z0-9]{8,32}$'),
 reported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Synthetic bank-statement evidence entered by DBA only, not by student or finance role.
CREATE TABLE vpo_stage.demo_statement_lines (
 transfer_ref text PRIMARY KEY CHECK(transfer_ref ~ '^DEMO-[A-Z0-9]{8,32}$'),
 amount_units integer NOT NULL CHECK(amount_units>0),
 order_id uuid NOT NULL REFERENCES vpo_stage.demo_orders(id)
);
CREATE TABLE vpo_stage.demo_reconciliations (
 order_id uuid PRIMARY KEY REFERENCES vpo_stage.demo_orders(id),
 transfer_ref text UNIQUE NOT NULL REFERENCES vpo_stage.demo_statement_lines(transfer_ref),
 officer name NOT NULL REFERENCES vpo_stage.demo_staff(login_name),
 reconciled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE vpo_stage.demo_certificates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL UNIQUE REFERENCES vpo_stage.demo_results(case_id),
 token_hash bytea UNIQUE NOT NULL CHECK(octet_length(token_hash)=32),
 officer name NOT NULL REFERENCES vpo_stage.demo_staff(login_name),
 revoke_requested_by name REFERENCES vpo_stage.demo_staff(login_name),
 revoked_by name REFERENCES vpo_stage.demo_staff(login_name),
 revoke_reason text, issued_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz,
 CHECK(revoked_by IS NULL OR (revoke_requested_by IS NOT NULL AND revoked_by<>revoke_requested_by)),
 CHECK((revoked_by IS NULL)=(revoked_at IS NULL))
);
CREATE TABLE vpo_stage.demo_workflow_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
 object_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON vpo_stage.demo_staff,vpo_stage.demo_marking_cases,vpo_stage.demo_marking_assignments,vpo_stage.demo_marks,vpo_stage.demo_results,vpo_stage.demo_appeals,vpo_stage.demo_orders,vpo_stage.demo_payment_reports,vpo_stage.demo_statement_lines,vpo_stage.demo_reconciliations,vpo_stage.demo_certificates,vpo_stage.demo_workflow_audit FROM PUBLIC;
GRANT USAGE ON SCHEMA vpo_stage TO vpo_demo_staff;
-- All operations through explicitly granted routines, not direct table privileges.
COMMIT;