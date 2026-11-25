-- Isolated, synthetic V4.4 slice. Run only on a NEW staging DB.
-- Execute with a migration owner, never the app runtime role.
BEGIN;
CREATE SCHEMA vpo_stage;
REVOKE ALL ON SCHEMA vpo_stage FROM PUBLIC;
CREATE TABLE vpo_stage.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text UNIQUE NOT NULL CHECK(email=lower(email)),
 password_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vpo_stage.role_grants (
 user_id uuid NOT NULL REFERENCES vpo_stage.users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role='student'),
 revoked_at timestamptz,
 PRIMARY KEY(user_id,role)
);
CREATE TABLE vpo_stage.student_profiles (
 user_id uuid PRIMARY KEY REFERENCES vpo_stage.users(id) ON DELETE CASCADE,
 student_code text UNIQUE NOT NULL,
 name_vi text NOT NULL, name_latin text NOT NULL,
 grade text NOT NULL CHECK(grade IN ('10','11','12')),
 curriculum text NOT NULL,
 locale text NOT NULL CHECK(locale IN ('vi','en')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE TABLE vpo_stage.sessions (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
 user_id uuid NOT NULL REFERENCES vpo_stage.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 idle_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_owner ON vpo_stage.sessions(user_id);
CREATE INDEX session_expiry ON vpo_stage.sessions(expires_at);
CREATE TABLE vpo_stage.login_limits (
 bucket text NOT NULL, window_start timestamptz NOT NULL,
 hits integer NOT NULL CHECK(hits>0), PRIMARY KEY(bucket,window_start)
);
CREATE TABLE vpo_stage.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid REFERENCES vpo_stage.users(id),
 event text NOT NULL CHECK(event IN ('LOGIN_OK','LOGOUT','PROFILE_UPDATE')),
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA vpo_stage FROM PUBLIC;
COMMIT;