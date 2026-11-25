-- DBA only, fresh synthetic fixture, psql -v ON_ERROR_STOP=1 -v demo_email=learner@example.test -v mentor_login=... -f academy-fixture.sql
BEGIN;
INSERT INTO vpo_stage.academy_courses(code,title,version,rubric_version)
VALUES('DEMO-FOUNDATION-R1','Philosophical inquiry and argumentation',1,'DEMO-R1') RETURNING id AS course_id \gset
INSERT INTO vpo_stage.academy_lessons(course_id,ordinal,title,objective,lesson_text,practice) VALUES
(:'course_id',1,'Questions and concepts','Distinguish a philosophical question from an empirical question.','A philosophical question can ask what counts as knowledge, justice or a good reason. Empirical evidence informs such questions but may not settle the meaning or normative standard. Define terms and identify what would count as an answer.','Classify: Does a machine answer correctly? Does it understand? Give reasons.'),
(:'course_id',2,'Thesis and reasons','State a defensible thesis and supporting reasons.','A thesis answers the question. A reason must support it, not merely restate it. Identify assumptions that connect reasons to conclusions. A valid inference need not have true premises.','Write a thesis, two premises and a conclusion; identify one assumption.'),
(:'course_id',3,'Counterexample and objection','Test a claim with a relevant counterexample.','A counterexample challenges a universal claim by finding a case where the claim fails. An objection may challenge a premise or an inference. Explain why it matters before revising the thesis.','Challenge the claim that every correct answer proves understanding.'),
(:'course_id',4,'Ethics and competing values','Compare two normative principles in a dilemma.','A policy may protect fairness but limit autonomy. Compare the reasons behind each value, identify affected parties and specify boundary conditions. Disagreement is not evidence of bad faith.','Propose a fair classroom AI rule; argue against your own proposal.'),
(:'course_id',5,'Revision with reasons','Improve an argument using feedback without outsourcing judgment.','Revision should change reasoning, not merely wording. Identify feedback, decide whether it is justified, explain what you accept or reject and show the effect on your conclusion.','Write a revision note identifying a specific changed premise and its justification.'),
(:'course_id',6,'Transfer to a new question','Apply reasoning independently to an unfamiliar context.','Transfer requires adapting principles to a new question, not copying a model essay. A stronger text may reflect help rather than independent competence. Compare evidence under stated conditions and do not infer causality from one comparison.','Explain what would count as evidence that a learner can reason in a different context.');
INSERT INTO vpo_stage.academy_tasks(course_id,stage,prompt,condition) VALUES
(:'course_id','BASELINE','Is a correct answer sufficient evidence of understanding? Develop a thesis, reasons and an objection.','INDEPENDENT_DECLARED'),
(:'course_id','REVISION','Revisit the baseline question. Address feedback, defend changes in reasoning and explain one suggestion you accepted or rejected.','FEEDBACK_SUPPORTED'),
(:'course_id','TRANSFER','Should a fair decision always treat everyone in exactly the same way? Develop a thesis, reasons, a counterexample and boundary conditions.','INDEPENDENT_DECLARED');
INSERT INTO vpo_stage.academy_enrolments(course_id,user_id,mentor)
SELECT :'course_id',u.id,m.login_name FROM vpo_stage.users u CROSS JOIN vpo_stage.academy_mentors m
WHERE u.email=:'demo_email' AND u.email LIKE '%@example.test' AND u.status='ACTIVE' AND m.login_name=:'mentor_login'
RETURNING id AS enrolment_id;
COMMIT;