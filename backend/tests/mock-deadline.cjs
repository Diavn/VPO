"use strict";
// Exercise the background deadline worker with no HTTP request after saving until DB observes receipt.
const assert=require("node:assert/strict"),{randomUUID}=require("node:crypto"),{Client}=require("pg");
const e=process.env,base="http://localhost:8080";
if(e.VPO_MODE!=="synthetic-staging"||e.VPO_ORIGIN!==base||e.VPO_CI_DISPOSABLE!=="yes"||!(e.GITHUB_ACTIONS==="true"||e.CODESPACES==="true"))throw Error("Disposable localhost only");
async function call(path,method="GET",s,b){const headers={};if(method!=="GET")headers.Origin=base;if(s){headers.Cookie=s.cookie;headers["X-CSRF-Token"]=s.csrf;}if(b!==undefined)headers["Content-Type"]="application/json";const r=await fetch(base+path,{method,headers,body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(10000)});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")};}
async function main(){
 const db=new Client({connectionString:e.VPO_CI_OWNER_DB,statement_timeout:10000,connectionTimeoutMillis:3000});
 try{
 await db.connect();assert.equal((await db.query("SELECT current_database() AS db,session_user AS actor")).rows[0].db,"vpo_ci");
 const login=await call("/auth/login","POST",null,{email:e.VPO_TEST_B_EMAIL,password:e.VPO_TEST_B_PASSWORD});assert.equal(login.status,200);const s={cookie:login.cookie.split(";")[0],csrf:login.data.csrf};
 const uid=(await db.query("SELECT id FROM vpo_stage.users WHERE email=$1 AND email LIKE '%@example.test'",[e.VPO_TEST_B_EMAIL])).rows[0].id;
 // A separate round closes soon; duration minimum remains 60s. No timestamp rewriting.
 const rid=(await db.query("INSERT INTO vpo_stage.demo_rounds(label,opens_at,closes_at,duration_seconds,topic) VALUES('DEMO deadline worker',clock_timestamp()-interval '1 second',clock_timestamp()+interval '20 seconds',60,'Synthetic deadline practice') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO vpo_stage.demo_enrolments(round_id,user_id) VALUES($1,$2)",[rid,uid]);
 const start=await call("/rounds/"+rid+"/attempts","POST",s);assert.equal(start.status,201);const id=start.data.id,root="/attempts/"+id,essay="Last acknowledged synthetic essay — deadline worker";
 const save=await call(root+"/draft","PUT",s,{expected_seq:0,op_id:randomUUID(),body:essay});assert.equal(save.status,200);assert.equal(save.data.ack_seq,1);
 let observed;const until=Date.now()+45000;
 // Owner observes DB only; GET /attempts would trigger lazy settlement and invalidate this test.
 while(Date.now()<until){const r=await db.query("SELECT a.state,a.deadline,s.receipt_id,s.seq,s.reason,s.submitted_at,d.body FROM vpo_stage.demo_attempts a JOIN vpo_stage.demo_submissions s ON s.attempt_id=a.id JOIN vpo_stage.demo_drafts d ON d.attempt_id=s.attempt_id AND d.seq=s.seq WHERE a.id=$1",[id]);if(r.rowCount){observed=r.rows[0];break;}await new Promise(r=>setTimeout(r,500));}
 assert(observed,"background worker must persist receipt without client traffic");assert.equal(observed.state,"EXPIRED");assert.equal(observed.reason,"DEADLINE");assert.equal(observed.seq,1);assert.equal(observed.body,essay);assert(observed.submitted_at>=observed.deadline);
 const receipt=await call(root+"/receipt","GET",s);assert.equal(receipt.status,200);assert.equal(receipt.data.receipt.receipt_id,observed.receipt_id);
 assert.equal((await call(root+"/draft","PUT",s,{expected_seq:1,op_id:randomUUID(),body:"Late revision"})).status,410);
 const replay=await call(root+"/submit","POST",s,{expected_seq:1});assert.equal(replay.status,200);assert.equal(replay.data.receipt.receipt_id,observed.receipt_id);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM vpo_stage.demo_submissions WHERE attempt_id=$1",[id])).rows[0].n,1);
 console.log("MOCK-DEADLINE PASS: autonomous worker, exact final acknowledged text, one immutable receipt, late save denied.");
 }finally{await db.end().catch(()=>{});}
}
main().catch(err=>{console.error("Mock deadline check failed:",err.code||err.name);process.exitCode=1;});