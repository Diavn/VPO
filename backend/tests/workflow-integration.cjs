"use strict";
const assert=require("node:assert/strict"),{Client}=require("pg");
const e=process.env,base=e.VPO_ORIGIN,cid=e.VPO_CI_CASE,oid=e.VPO_CI_ORDER;
if(e.GITHUB_ACTIONS!=="true"||e.VPO_CI_DISPOSABLE!=="yes"||e.VPO_MODE!=="synthetic-staging"||base!=="http://localhost:8080")throw Error("CI disposable fixture required");
const roles=["ci_exam_a","ci_exam_b","ci_moderator","ci_approver","ci_publisher","ci_finance","ci_appeal","ci_cert","ci_cert_approver"];
const db={};
async function staff(role,op,id=null,b={}){return (await db[role].query("SELECT vpo_stage.demo_staff_action($1,$2::uuid,$3::jsonb) AS value",[op,id,JSON.stringify(b)])).rows[0].value;}
async function call(path,method="GET",s=null,b){const headers={};if(method!=="GET")headers.Origin=base;if(s){headers.Cookie=s.cookie;headers["X-CSRF-Token"]=s.csrf;}if(b!==undefined)headers["Content-Type"]="application/json";const r=await fetch(base+path,{method,headers,body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(15000),redirect:"error"});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")};}
async function login(email,password){const r=await call("/auth/login","POST",null,{email,password});assert.equal(r.status,200);return {cookie:r.cookie.split(";")[0],csrf:r.data.csrf};}
async function main(){
 try{
  for(const role of roles){db[role]=new Client({connectionString:e["VPO_DB_"+role],statement_timeout:10000,connectionTimeoutMillis:3000});await db[role].connect();assert.equal((await db[role].query("SELECT session_user AS u")).rows[0].u,role);}
  const a=await login(e.VPO_TEST_A_EMAIL,e.VPO_TEST_A_PASSWORD),b=await login(e.VPO_TEST_B_EMAIL,e.VPO_TEST_B_PASSWORD);
  const x=(await staff("ci_exam_a","queue"))[0].assignment_id,y=(await staff("ci_exam_b","queue"))[0].assignment_id;
  await assert.rejects(()=>staff("ci_exam_a","read_assigned",y));await assert.rejects(()=>db.ci_exam_a.query("SELECT * FROM vpo_stage.users"));
  const read=await staff("ci_exam_a","read_assigned",x);assert(!("email" in read));assert(!("user_id" in read));
  const f={scores:[2,2,2,2,2],reason:"Synthetic rationale"};
  await staff("ci_exam_a","lock_mark",x,f);await assert.rejects(()=>staff("ci_exam_a","lock_mark",x,f));
  await assert.rejects(()=>staff("ci_moderator","propose",cid,{award:"FIRST",reason:"Synthetic"}));
  await staff("ci_exam_b","lock_mark",y,{...f,scores:[4,4,4,4,4]});
  await assert.rejects(()=>staff("ci_moderator","propose",cid,{award:"FIRST",reason:"Synthetic"}));
  const pr=await staff("ci_moderator","propose",cid,{award:"FIRST",reason:"Synthetic adjudication",adjudicated_scores:[3,3,3,3,3]});assert.equal(Number(pr.score),15);
  await assert.rejects(()=>staff("ci_moderator","approve",cid));await assert.rejects(()=>staff("ci_publisher","publish",cid));
  await staff("ci_approver","approve",cid);
  assert.equal((await call("/me/results","GET",a)).data.data.length,0);
  await staff("ci_publisher","publish",cid);
  const own=await call("/me/results","GET",a);assert.equal(own.status,200);assert.equal(Number(own.data.data[0].score),15);assert.equal((await call("/me/results","GET",b)).data.data.length,0);
  const report="/me/orders/"+oid+"/report";
  assert.equal((await call(report,"POST",b,{transfer_ref:e.VPO_CI_TRANSFER})).status,404);
  assert.equal((await call(report,"POST",a,{transfer_ref:e.VPO_CI_TRANSFER,state:"PAID"})).status,422);
  await assert.rejects(()=>staff("ci_finance","reconcile",oid));
  assert.equal((await call(report,"POST",a,{transfer_ref:e.VPO_CI_TRANSFER})).status,201);
  assert.equal((await call("/me/orders","GET",a)).data.data[0].state,"REPORTED");
  await staff("ci_finance","reconcile",oid);await assert.rejects(()=>staff("ci_finance","reconcile",oid));
  assert.equal((await call("/me/orders","GET",a)).data.data[0].state,"PAID");
  const c=await staff("ci_cert","cert_issue",cid);assert.equal(c.verification_token.length,64);
  const url=c.verification_path;assert.equal((await call(url)).data.status,"VALID_DEMO");
  assert.equal((await call("/public/certificates/"+"0".repeat(64))).status,404);
  const appeal="/me/results/"+cid+"/appeal";assert.equal((await call(appeal,"POST",b,{category:"SCORING"})).status,404);
  assert.equal((await call(appeal,"POST",a,{category:"SCORING"})).status,201);assert.equal((await call(url)).data.status,"ON_HOLD");
  await staff("ci_appeal","appeal_decide",cid,{decision:"DISMISSED",reason:"Synthetic review"});assert.equal((await call(url)).data.status,"VALID_DEMO");
  await staff("ci_cert","cert_revoke_request",c.certificate_id,{reason:"Synthetic revocation"});
  await assert.rejects(()=>staff("ci_cert","cert_revoke_approve",c.certificate_id));assert.equal((await call(url)).data.status,"ON_HOLD");
  await staff("ci_cert_approver","cert_revoke_approve",c.certificate_id);assert.equal((await call(url)).data.status,"REVOKED");
  await call("/auth/logout","POST",a);await call("/auth/logout","POST",b);
  console.log("Workflow synthetic smoke passed.");
 }finally{await Promise.all(Object.values(db).map(x=>x.end().catch(()=>{})));}
}
main().catch(e=>{console.error("Workflow smoke failed:",e.code||e.name);process.exitCode=1;});