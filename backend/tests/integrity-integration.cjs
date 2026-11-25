"use strict";
// ONLY disposable synthetic DB; run after all four baseline smoke groups.
const assert=require("node:assert/strict"),{Client}=require("pg"),{randomUUID}=require("node:crypto");
const e=process.env,base=e.VPO_ORIGIN;
if((e.GITHUB_ACTIONS!=="true"&&e.CODESPACES!=="true")||e.VPO_CI_DISPOSABLE!=="yes"||e.VPO_MODE!=="synthetic-staging"||base!=="http://localhost:8080")throw Error("Disposable test only");
const connect=async url=>{const d=new Client({connectionString:url,statement_timeout:10000,connectionTimeoutMillis:3000});await d.connect();return d;};
async function request(path,method="GET",s=null,b){const headers={};if(method!=="GET")headers.Origin=base;if(s){headers.Cookie=s.cookie;headers["X-CSRF-Token"]=s.csrf;}if(b!==undefined)headers["Content-Type"]="application/json";const r=await fetch(base+path,{method,headers,body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(15000),redirect:"error"});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")};}
async function login(email,password){const r=await request("/auth/login","POST",null,{email,password});assert.equal(r.status,200);return {cookie:r.cookie.split(";")[0],csrf:r.data.csrf};}
async function rejected(db,fn,code){await db.query("BEGIN");try{await assert.rejects(fn,err=>err.code===code);}finally{await db.query("ROLLBACK");}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const ds=[];try{
 const owner=await connect(e.VPO_CI_OWNER_DB);ds.push(owner);
 const rt=await connect(e.DATABASE_URL);ds.push(rt);
 const staff=await connect(e.VPO_DB_ci_exam_a);ds.push(staff);
 const mentor=await connect(e.VPO_TEST_MENTOR_DB);ds.push(mentor);
 assert.equal((await rt.query("SELECT session_user AS u")).rows[0].u,"vpo_runtime");
 const ids=(await owner.query("SELECT id,email FROM vpo_stage.users WHERE email IN ($1,$2) ORDER BY email",[e.VPO_TEST_A_EMAIL,e.VPO_TEST_B_EMAIL])).rows;
 assert.equal(ids.length,2);const [a,b]=ids;
 // DB01: profile RLS default deny and transaction-local scope; not stolen-runtime isolation.
 assert.equal((await rt.query("SELECT count(*)::int AS n FROM vpo_stage.student_profiles")).rows[0].n,0);
 await rt.query("BEGIN");
 try{await rt.query("SELECT set_config('vpo.student_id',$1,true)",[a.id]);assert.deepEqual((await rt.query("SELECT user_id FROM vpo_stage.student_profiles")).rows.map(x=>x.user_id),[a.id]);assert.equal((await rt.query("UPDATE vpo_stage.student_profiles SET grade='10' WHERE user_id=$1",[b.id])).rowCount,0);}finally{await rt.query("ROLLBACK");}
 assert.equal((await rt.query("SELECT count(*)::int AS n FROM vpo_stage.student_profiles")).rows[0].n,0);console.log("DB01 profile RLS and reset PASS");
 // DB02: cross-role direct DB grants.
 for(const d of [staff,mentor]){await rejected(d,()=>d.query("SELECT * FROM vpo_stage.student_profiles"),"42501");await rejected(d,()=>d.query("SELECT * FROM vpo_stage.demo_drafts"),"42501");await rejected(d,()=>d.query("SELECT vpo_stage.lock_student_session('x',$1)",[a.id]),"42501");}
 await rejected(rt,()=>rt.query("SELECT vpo_stage.demo_staff_action('queue',NULL,'{}')"),"42501");
 await rejected(rt,()=>rt.query("SELECT vpo_stage.academy_mentor('queue',NULL,'{}')"),"42501");
 await rejected(rt,()=>rt.query("SELECT * FROM vpo_stage.demo_marks"),"42501");
 await rejected(rt,()=>rt.query("UPDATE vpo_stage.demo_results SET score=20"),"42501");
 await rejected(rt,()=>rt.query("UPDATE vpo_stage.demo_orders SET state='PAID'"),"42501");console.log("DB02 direct cross-role denials PASS");
 const prior=(await owner.query("SELECT a.id,a.latest_seq FROM vpo_stage.demo_attempts a JOIN vpo_stage.demo_submissions s ON s.attempt_id=a.id")).rows[0];assert(prior);
 await rejected(rt,()=>rt.query("UPDATE vpo_stage.demo_drafts SET body='changed' WHERE attempt_id=$1",[prior.id]),"42501");
 await rejected(rt,()=>rt.query("DELETE FROM vpo_stage.demo_submissions WHERE attempt_id=$1",[prior.id]),"42501");
 await rejected(rt,()=>rt.query("UPDATE vpo_stage.demo_attempts SET state='ACTIVE' WHERE id=$1",[prior.id]),"23514");
 await rejected(rt,()=>rt.query("INSERT INTO vpo_stage.demo_drafts(attempt_id,seq,op_id,body,saved_at) VALUES($1,$2,$3,'late',clock_timestamp())",[prior.id,prior.latest_seq+1,randomUUID()]),"23514");
 console.log("DB03/04 terminal immutability PASS");
 const sa=await login(e.VPO_TEST_A_EMAIL,e.VPO_TEST_A_PASSWORD),sb=await login(e.VPO_TEST_B_EMAIL,e.VPO_TEST_B_PASSWORD);
 // Fresh round closed by the worker, not by an HTTP read.
 const rid=(await owner.query("INSERT INTO vpo_stage.demo_rounds(label,opens_at,closes_at,duration_seconds,topic) VALUES('DEMO expiry test',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '18 seconds',60,'Synthetic deadline question') RETURNING id")).rows[0].id;
 await owner.query("INSERT INTO vpo_stage.demo_enrolments(round_id,user_id) VALUES($1,$2)",[rid,a.id]);
 const started=await request("/rounds/"+rid+"/attempts","POST",sa);assert.equal(started.status,201);const aid=started.data.id,root="/attempts/"+aid;
 // Force deferred validation on deliberately inconsistent sequence change.
 await rejected(rt,async()=>{await rt.query("UPDATE vpo_stage.demo_attempts SET latest_seq=1 WHERE id=$1",[aid]);await rt.query("SET CONSTRAINTS ALL IMMEDIATE");},"23514");
 assert.equal((await request(root+"/draft","GET",sb)).status,404);
 const saved=await request(root+"/draft","PUT",sa,{expected_seq:0,op_id:randomUUID(),body:"Synthetic saved before deadline"});assert.equal(saved.status,200);assert.equal(saved.data.ack_seq,1);
 let final;for(let i=0;i<35;i++){final=(await owner.query("SELECT a.state,s.seq,s.reason FROM vpo_stage.demo_attempts a LEFT JOIN vpo_stage.demo_submissions s ON s.attempt_id=a.id WHERE a.id=$1",[aid])).rows[0];if(final.state==="EXPIRED")break;await sleep(1000);}
 assert.deepEqual(final,{state:"EXPIRED",seq:1,reason:"DEADLINE"});
 assert.equal((await request(root+"/draft","PUT",sa,{expected_seq:1,op_id:randomUUID(),body:"Too late"})).status,410);
 assert.equal((await request(root+"/receipt","GET",sa)).data.receipt.seq,1);console.log("DB05/06 deferred integrity and automatic deadline settlement PASS");
 // Revocation after commit; test actual lock interaction with a separate connection.
 const hash=require("node:crypto").createHash("sha256").update(sa.cookie.split("=")[1]).digest("hex");
 await rt.query("BEGIN");
 let revoking;
 try{
  assert.equal((await rt.query("SELECT vpo_stage.lock_student_session($1,$2) AS live",[hash,a.id])).rows[0].live,true);
  let done=false;revoking=owner.query("UPDATE vpo_stage.role_grants SET revoked_at=clock_timestamp() WHERE user_id=$1",[a.id]).then(()=>{done=true;});
  await sleep(300);assert.equal(done,false,"Revocation must wait for protected transaction");
 }finally{await rt.query("ROLLBACK");if(revoking)await revoking;}
 assert.equal((await request("/me","GET",sa)).status,401);
 assert.equal((await request("/me/academy","GET",sa)).status,401);
 assert.equal((await request("/me/orders","GET",sa)).status,401);
 assert.equal((await request("/me","GET",sb)).status,200);
 await owner.query("UPDATE vpo_stage.role_grants SET revoked_at=NULL WHERE user_id=$1",[a.id]);
 await owner.query("UPDATE vpo_stage.users SET status='SUSPENDED' WHERE id=$1",[a.id]);
 assert.equal((await request("/me","GET",sa)).status,401);
 await owner.query("UPDATE vpo_stage.users SET status='ACTIVE' WHERE id=$1",[a.id]);
 await owner.query("DELETE FROM vpo_stage.sessions WHERE user_id=$1",[a.id]);
 assert.equal((await request("/me","GET",sa)).status,401);console.log("DB07 role revocation, suspension, session deletion PASS");
 // Baseline workflow assertions verified independently at DB layer.
 const checks=(await owner.query("SELECT (SELECT count(*) FROM vpo_stage.demo_marks)::int AS marks,(SELECT count(*) FROM vpo_stage.demo_results WHERE state='PUBLISHED')::int AS published,(SELECT count(*) FROM vpo_stage.demo_reconciliations)::int AS reconciled,(SELECT count(*) FROM vpo_stage.demo_certificates WHERE revoked_at IS NOT NULL)::int AS revoked,(SELECT count(*) FROM vpo_stage.academy_feedback)::int AS feedback,(SELECT count(*) FROM vpo_stage.demo_workflow_audit)::int AS audit")).rows[0];
 assert.equal(checks.marks,2);assert.equal(checks.published,1);assert.equal(checks.reconciled,1);assert.equal(checks.revoked,1);assert.equal(checks.feedback,3);assert(checks.audit>=10);
 await rejected(rt,()=>rt.query("DELETE FROM vpo_stage.demo_workflow_audit"),"42501");
 console.log("DB08/09/10 workflow consistency and audit grants PASS");
 }finally{await Promise.all(ds.map(d=>d.end().catch(()=>{})));}
}
main().catch(e=>{console.error("V5.3 integrity smoke failed:",e.code||e.name,e.message);process.exitCode=1;});