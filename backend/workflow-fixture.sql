-- DBA only. Use previously submitted synthetic attempt. psql -v attempt_id=... -v examiner_a=... -v examiner_b=... -f workflow-fixture.sql
BEGIN;
INSERT INTO vpo_stage.demo_marking_cases(attempt_id)
SELECT a.id FROM vpo_stage.demo_attempts a JOIN vpo_stage.demo_submissions s ON s.attempt_id=a.id JOIN vpo_stage.users u ON u.id=a.user_id
WHERE a.id=:'attempt_id'::uuid AND u.email LIKE '%@example.test'
RETURNING id AS case_id \gset
INSERT INTO vpo_stage.demo_marking_assignments(case_id,examiner)
SELECT :'case_id'::uuid,login_name FROM vpo_stage.demo_staff WHERE role='examiner' AND login_name IN (:'examiner_a',:'examiner_b');
-- No real currency. One artificial fee and reference per round/student.
INSERT INTO vpo_stage.demo_orders(round_id,user_id,amount_units)
SELECT round_id,user_id,100 FROM vpo_stage.demo_attempts WHERE id=:'attempt_id'::uuid
ON CONFLICT(round_id,user_id) DO NOTHING;
SELECT o.id AS order_id,o.amount_units AS order_units FROM vpo_stage.demo_orders o JOIN vpo_stage.demo_attempts a ON a.round_id=o.round_id AND a.user_id=o.user_id WHERE a.id=:'attempt_id'::uuid \gset
INSERT INTO vpo_stage.demo_statement_lines(transfer_ref,amount_units,order_id)
SELECT 'DEMO-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),:'order_units'::integer,:'order_id'::uuid
WHERE NOT EXISTS(SELECT 1 FROM vpo_stage.demo_statement_lines WHERE order_id=:'order_id'::uuid)
RETURNING transfer_ref,order_id;
SELECT :'case_id' AS case_id,:'order_id' AS order_id;
COMMIT;