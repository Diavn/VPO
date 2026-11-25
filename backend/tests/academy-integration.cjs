"use strict";
// Destructive-to-fixtures only: submits three synthetic essays and writes feedback.
const assert=require("node:assert/strict"),{randomUUID}=require("node:crypto"),{Client}=require("pg");
const env=process.env,base=env.VPO_ORIGIN,id=env.VPO_TEST_ACADEMY_ENROLMENT;
if(env.VPO_MODE!=="synthetic-staging"||!/^http:\/\/localhost:\d+$/.test(base||"")||!/^[a-f0-9-]{36}$/i.test(id||""))throw Error("Local disposable synthetic fixture required");
if(!env.VPO_TEST_A_EMAIL?.endsWith("@example.test")||!env.VPO_TEST_B_EMAIL?.endsWith("@example.test")||env.VPO_TEST_A_EMAIL===env.VPO_TEST_B_EMAIL||!env.VPO_TEST_MENTOR_DB||!env.VPO_TEST_OTHER_MENTOR_DB)throw Error("Two fake students and two distinct local mentor DB connections required");
async function call(path,method="GET",s=null,b,csrf=true){
 const headers={};if(method!=="GET")headers.Origin=base;if(s){headers.Cookie=s.cookie;if(csrf)headers["X-CSRF-Token"]=s.csrf;}if(b!==undefined)headers["Content-Type"]="application/json";
 const r=await fetch(base+path,{method,headers,body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(15000),redirect:"error"});
 return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")};
}
async function login(email,password){const r=await call("/auth/login","POST",null,{email,password});assert.equal(r.status,200);return {cookie:r.cookie.split(";")[0],csrf:r.data.csrf};}
const root="/me/academy/"+id;
const make=(stage,condition,revision_note="")=>({stage,condition,revision_note,essay:"Synthetic "+stage+" argument, example and objection.",op_id:randomUUID()});
async function mentor(db,op,obj,b={}){return (await db.query("SELECT vpo_stage.academy_mentor($1,$2::uuid,$3::jsonb) AS value",[op,obj,JSON.stringify(b)])).rows[0].value;}
async function main(){
 const m=new Client({connectionString:env.VPO_TEST_MENTOR_DB,statement_timeout:10000,connectionTimeoutMillis:3000});
 const n=new Client({connectionString:env.VPO_TEST_OTHER_MENTOR_DB,statement_timeout:10000,connectionTimeoutMillis:3000});
 try{
  await m.connect();await n.connect();assert.notEqual((await m.query("SELECT session_user AS u")).rows[0].u,(await n.query("SELECT session_user AS u")).rows[0].u);
  const a=await login(env.VPO_TEST_A_EMAIL,env.VPO_TEST_A_PASSWORD),b=await login(env.VPO_TEST_B_EMAIL,env.VPO_TEST_B_PASSWORD);
  assert.equal((await call(root+"/portfolio")).status,401);assert.equal((await call(root+"/portfolio","GET",b)).status,404);
  const start=await call(root+"/portfolio","GET",a);assert.equal(start.status,200);assert.equal(start.data.data.submissions.length,0);assert.equal(start.data.data.lessons.length,6);assert.equal(start.data.analytics.assessed_tasks,0);
  assert.equal(start.data.data.tasks.find(t=>t.stage==="REVISION").prompt,null);
  assert.equal(start.data.data.tasks.find(t=>t.stage==="TRANSFER").prompt,null);
  assert.equal((await call(root+"/completion","POST",a,{ordinal:1},false)).status,403);
  assert.equal((await call(root+"/completion","POST",a,{ordinal:1})).status,200);
  assert.equal((await call(root+"/completion","POST",a,{ordinal:1})).status,200);
  const revision=make("REVISION","FEEDBACK_SUPPORTED","Changed the premise after feedback.");
  const transfer=make("TRANSFER","INDEPENDENT_DECLARED");
  assert.equal((await call(root+"/submissions","POST",a,revision)).status,409);
  assert.equal((await call(root+"/submissions","POST",a,transfer)).status,409);
  const baseline=make("BASELINE","INDEPENDENT_DECLARED");
  const submitted=await call(root+"/submissions","POST",a,baseline);assert.equal(submitted.status,201);const bid=submitted.data.data.id;
  const replay=await call(root+"/submissions","POST",a,baseline);assert.equal(replay.status,200);assert.equal(replay.data.data.id,bid);
  assert.equal((await call(root+"/submissions","POST",a,{...baseline,essay:"Changed"})).status,409);
  assert.equal((await call(root+"/submissions","POST",a,make("BASELINE","INDEPENDENT_DECLARED"))).status,409);
  assert.equal((await call(root+"/submissions","POST",a,revision)).status,409);
  const before=await call(root+"/portfolio","GET",a);assert.equal(before.data.analytics.completed_lessons,1);assert.equal(before.data.analytics.assessed_tasks,0);assert.equal(before.data.analytics.baseline_score,null);
  await assert.rejects(()=>mentor(n,"read",bid));await assert.rejects(()=>mentor(n,"feedback",bid,{scores:[4,4,4,4,4],evidence:"Unassigned",next_action:"None"}));
  const read=await mentor(m,"read",bid);assert.equal(read.essay,baseline.essay);assert(!("user_id" in read));assert(!("email" in read));
  const f={scores:[2,2,2,2,2],evidence:"Synthetic rationale",next_action:"Test an objection"};
  await mentor(m,"feedback",bid,f);await assert.rejects(()=>mentor(m,"feedback",bid,f));
  const after=await call(root+"/portfolio","GET",a);assert.equal(after.data.analytics.baseline_score,10);assert(after.data.data.tasks.find(t=>t.stage==="REVISION").prompt);
  const rev=await call(root+"/submissions","POST",a,revision);assert.equal(rev.status,201);assert.equal((await call(root+"/submissions","POST",a,transfer)).status,409);
  await mentor(m,"feedback",rev.data.data.id,{...f,scores:[3,3,3,3,3]});
  const tr=await call(root+"/submissions","POST",a,transfer);assert.equal(tr.status,201);
  await mentor(m,"feedback",tr.data.data.id,{...f,scores:[2,3,2,3,2]});
  const fin=await call(root+"/portfolio","GET",a);assert.equal(fin.data.analytics.assessed_tasks,3);assert.equal(fin.data.analytics.revision_difference,5);assert.equal(fin.data.analytics.declared_independent_transfer_difference,2);
  assert.equal((await call(root+"/portfolio","GET",b)).status,404);
  await call("/auth/logout","POST",a);await call("/auth/logout","POST",b);
  console.log("Synthetic Academy HTTP/DB smoke passed");
 }finally{await m.end().catch(()=>{});await n.end().catch(()=>{});}
}
main().catch(()=>{console.error("Academy smoke failed. Inspect disposable staging diagnostics without logging credentials.");process.exitCode=1;});