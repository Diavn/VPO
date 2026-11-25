-- V4.5 additive migration for disposable vpo_stage only. Run as migration owner.
BEGIN;
CREATE TABLE vpo_stage.demo_rounds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL CHECK(label LIKE 'DEMO%'),
 opens_at timestamptz NOT NULL, closes_at timestamptz NOT NULL,
 duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 60 AND 14400),
 topic text NOT NULL CHECK(octet_length(topic) BETWEEN 1 AND 8000),
 CHECK(closes_at>opens_at)
);
CREATE TABLE vpo_stage.demo_enrolments (
 round_id uuid NOT NULL REFERENCES vpo_stage.demo_rounds(id),
 user_id uuid NOT NULL REFERENCES vpo_stage.users(id),
 PRIMARY KEY(round_id,user_id)
);
CREATE TABLE vpo_stage.demo_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 round_id uuid NOT NULL, user_id uuid NOT NULL,
 started_at timestamptz NOT NULL, deadline timestamptz NOT NULL,
 latest_seq integer NOT NULL DEFAULT 0 CHECK(latest_seq>=0),
 topic_snapshot text NOT NULL, state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','SUBMITTED','EXPIRED')),
 UNIQUE(round_id,user_id), FOREIGN KEY(round_id,user_id) REFERENCES vpo_stage.demo_enrolments(round_id,user_id),
 CHECK(deadline>started_at)
);
CREATE INDEX demo_attempt_due ON vpo_stage.demo_attempts(deadline) WHERE state='ACTIVE';
CREATE TABLE vpo_stage.demo_drafts (
 attempt_id uuid NOT NULL REFERENCES vpo_stage.demo_attempts(id),
 seq integer NOT NULL CHECK(seq>=0), op_id uuid NOT NULL,
 body text NOT NULL CHECK(octet_length(body)<=40000),
 saved_at timestamptz NOT NULL, PRIMARY KEY(attempt_id,seq), UNIQUE(attempt_id,op_id)
);
CREATE TABLE vpo_stage.demo_submissions (
 attempt_id uuid PRIMARY KEY REFERENCES vpo_stage.demo_attempts(id),
 receipt_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 seq integer NOT NULL, reason text NOT NULL CHECK(reason IN ('MANUAL','DEADLINE')),
 submitted_at timestamptz NOT NULL,
 FOREIGN KEY(attempt_id,seq) REFERENCES vpo_stage.demo_drafts(attempt_id,seq)
);
CREATE TABLE vpo_stage.demo_events (
 attempt_id uuid NOT NULL REFERENCES vpo_stage.demo_attempts(id),
 event_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('HIDDEN','VISIBLE','RECONNECTED')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(attempt_id,event_id)
);
REVOKE ALL ON vpo_stage.demo_rounds,vpo_stage.demo_enrolments,vpo_stage.demo_attempts,vpo_stage.demo_drafts,vpo_stage.demo_submissions,vpo_stage.demo_events FROM PUBLIC;
GRANT SELECT ON vpo_stage.demo_rounds,vpo_stage.demo_enrolments TO vpo_runtime;
GRANT SELECT,INSERT ON vpo_stage.demo_attempts,vpo_stage.demo_drafts,vpo_stage.demo_submissions,vpo_stage.demo_events TO vpo_runtime;
GRANT UPDATE(latest_seq,state) ON vpo_stage.demo_attempts TO vpo_runtime;
-- No runtime UPDATE/DELETE on saved revisions or receipts. Migration owner remains privileged.
COMMIT;