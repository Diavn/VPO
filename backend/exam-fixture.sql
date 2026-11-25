-- DBA/migration owner only; replace the placeholder with a provisioned synthetic email using psql -v demo_email=...
-- No real exam. Single open synthetic round per invocation.
BEGIN;
WITH r AS (
 INSERT INTO vpo_stage.demo_rounds(label,opens_at,closes_at,duration_seconds,topic)
 VALUES('DEMO Essay — NOT VPO EXAM',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 hours',1800,'Synthetic practice question: Is a correct answer sufficient evidence of understanding?')
 RETURNING id
)
INSERT INTO vpo_stage.demo_enrolments(round_id,user_id)
SELECT r.id,u.id FROM r CROSS JOIN vpo_stage.users u WHERE u.email=:'demo_email' AND u.email LIKE '%@example.test' AND u.status='ACTIVE'
RETURNING round_id;
COMMIT;
-- To test another fake account, the DBA must explicitly enrol it in a round; no student self-enrolment.
