-- V4.7 synthetic Academy. Apply only to isolated V4.6 staging DB as migration owner.
-- DBA first creates NOLOGIN vpo_demo_mentor (no membership in vpo_runtime or vpo_demo_staff).
BEGIN;
CREATE TABLE vpo_stage.academy_courses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL CHECK(code LIKE 'DEMO-%'),
 title text NOT NULL, version integer NOT NULL CHECK(version>0), rubric_version text NOT NULL CHECK(rubric_version='DEMO-R1')
);
CREATE TABLE vpo_stage.academy_lessons (
 course_id uuid NOT NULL REFERENCES vpo_stage.academy_courses(id), ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 6),
 title text NOT NULL, objective text NOT NULL, lesson_text text NOT NULL, practice text NOT NULL,
 PRIMARY KEY(course_id,ordinal)
);
CREATE TABLE vpo_stage.academy_tasks (
 course_id uuid NOT NULL REFERENCES vpo_stage.academy_courses(id),
 stage text NOT NULL CHECK(stage IN ('BASELINE','REVISION','TRANSFER')),
 prompt text NOT NULL, condition text NOT NULL CHECK(condition IN ('INDEPENDENT_DECLARED','FEEDBACK_SUPPORTED')),
 PRIMARY KEY(course_id,stage),
 CHECK((stage='REVISION')=(condition='FEEDBACK_SUPPORTED'))
);
CREATE TABLE vpo_stage.academy_mentors (
 login_name name PRIMARY KEY
);
CREATE TABLE vpo_stage.academy_enrolments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 course_id uuid NOT NULL REFERENCES vpo_stage.academy_courses(id), user_id uuid NOT NULL REFERENCES vpo_stage.users(id),
 mentor name NOT NULL REFERENCES vpo_stage.academy_mentors(login_name),
 enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(course_id,user_id), UNIQUE(id,course_id)
);
CREATE TABLE vpo_stage.academy_completion (
 enrolment_id uuid NOT NULL, course_id uuid NOT NULL, ordinal integer NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(enrolment_id,ordinal),
 FOREIGN KEY(enrolment_id,course_id) REFERENCES vpo_stage.academy_enrolments(id,course_id),
 FOREIGN KEY(course_id,ordinal) REFERENCES vpo_stage.academy_lessons(course_id,ordinal)
);
CREATE TABLE vpo_stage.academy_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrolment_id uuid NOT NULL, course_id uuid NOT NULL,
 stage text NOT NULL, op_id uuid NOT NULL, essay text NOT NULL CHECK(octet_length(essay) BETWEEN 1 AND 40000),
 declared_condition text NOT NULL CHECK(declared_condition IN ('INDEPENDENT_DECLARED','FEEDBACK_SUPPORTED','OTHER_DECLARED')),
 revision_note text NOT NULL CHECK(octet_length(revision_note)<=2000),
 submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(enrolment_id,stage), UNIQUE(enrolment_id,op_id),
 FOREIGN KEY(enrolment_id,course_id) REFERENCES vpo_stage.academy_enrolments(id,course_id),
 FOREIGN KEY(course_id,stage) REFERENCES vpo_stage.academy_tasks(course_id,stage),
 CHECK(stage='REVISION' OR revision_note='')
);
CREATE TABLE vpo_stage.academy_feedback (
 submission_id uuid PRIMARY KEY REFERENCES vpo_stage.academy_submissions(id),
 mentor name NOT NULL REFERENCES vpo_stage.academy_mentors(login_name),
 scores smallint[] NOT NULL CHECK(cardinality(scores)=5 AND array_ndims(scores)=1 AND array_position(scores,NULL) IS NULL AND 0<=ALL(scores) AND 4>=ALL(scores)),
 evidence text NOT NULL CHECK(octet_length(evidence) BETWEEN 1 AND 2000),
 next_action text NOT NULL CHECK(octet_length(next_action) BETWEEN 1 AND 2000),
 assessed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON vpo_stage.academy_courses,vpo_stage.academy_lessons,vpo_stage.academy_tasks,vpo_stage.academy_mentors,vpo_stage.academy_enrolments,vpo_stage.academy_completion,vpo_stage.academy_submissions,vpo_stage.academy_feedback FROM PUBLIC;
GRANT USAGE ON SCHEMA vpo_stage TO vpo_demo_mentor;
-- No direct table access for runtime or mentors: only explicitly granted routines.
COMMIT;