-- Run as migration owner after creating LOGIN roles vpo_runtime and vpo_provision
-- using a secure DBA process; passwords must NOT appear in this file.
GRANT USAGE ON SCHEMA vpo_stage TO vpo_runtime,vpo_provision;
GRANT SELECT ON vpo_stage.users,vpo_stage.role_grants TO vpo_runtime;
GRANT SELECT ON vpo_stage.student_profiles TO vpo_runtime;
GRANT UPDATE(grade,curriculum,locale,version) ON vpo_stage.student_profiles TO vpo_runtime;
GRANT SELECT,INSERT,DELETE ON vpo_stage.sessions TO vpo_runtime;
GRANT UPDATE(idle_until) ON vpo_stage.sessions TO vpo_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON vpo_stage.login_limits TO vpo_runtime;
GRANT INSERT ON vpo_stage.audit_events TO vpo_runtime;
GRANT USAGE ON SEQUENCE vpo_stage.audit_events_id_seq TO vpo_runtime;
GRANT INSERT ON vpo_stage.users,vpo_stage.role_grants,vpo_stage.student_profiles TO vpo_provision;
GRANT SELECT(id) ON vpo_stage.users TO vpo_provision;
-- Neither role may own tables, grant roles, or have superuser/CREATEROLE privileges.
