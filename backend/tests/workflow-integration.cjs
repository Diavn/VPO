"use strict";
const assert=require("node:assert/strict"),{Client}=require("pg");
const e=process.env,base=e.VPO_ORIGIN,cid=e.VPO_CI_CASE,oid=e.VPO_CI_ORDER;
if((e.GITHUB_ACTIONS!=="true"&&e.CODESPACES!=="true")||e.VPO_CI_DISPOSABLE!=="yes"||e.VPO_MODE!=="synthetic-staging"||base!=="http://localhost:8080")throw Error("CI disposable fixture required");
const roles=["ci_exam_a","ci_exam_b","ci_moderator","ci_approver","ci_publisher","ci_finance","ci_appeal","ci_cert","ci_cert_approver"];
const db={};
const {spawn}=require("node:child_process"),{randomBytes}=require("node:crypto"),{chromium}=require("playwright");
let desk,deskKey;const deskBase="http://localhost:8081";
async function deskCall(op,id,body,key=deskKey,origin=deskBase){const r=await fetch(deskBase+"/api/action",{method:"POST",headers:{Origin:origin,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({op,id,body}),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json()};}
async function startDesk(){deskKey=randomBytes(32).toString("hex");desk=spawn(process.execPath,["staff-desk/server.cjs"],{cwd:require("node:path").join(__dirname,".."),env:{PATH:e.PATH,GITHUB_ACTIONS:e.GITHUB_ACTIONS||"",CODESPACES:e.CODESPACES||"",VPO_MODE:e.VPO_MODE,VPO_DESK_ROLE:"ci_exam_a",VPO_DESK_KEY:deskKey,DATABASE_URL:e.VPO_DB_ci_exam_a},stdio:"ignore"});for(let i=0;i<50;i++){if(desk.exitCode!==null)throw Error("Desk startup failed");try{if((await fetch(deskBase,{signal:AbortSignal.timeout(500)})).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}assert.equal((await deskCall("queue",null,{})).status,200);assert.equal((await deskCall("queue",null,{},"0".repeat(64))).status,401);assert.equal((await deskCall("queue",null,{},deskKey,"http://untrusted.example.test")).status,403);assert.equal((await deskCall("publish",cid,{})).status,422);}
async function browserDesk(x){const browser=await chromium.launch({headless:true});try{const p=await browser.newPage({viewport:{width:390,height:844}});const errors=[];p.on("pageerror",e=>errors.push(e.message));await p.goto(deskBase);await p.locator("#key").fill(deskKey);await p.locator("#connect").click();await p.locator("#work").waitFor({state:"visible"});assert.equal(await p.locator("#role").textContent(),"ci_exam_a");await p.getByRole("button",{name:"Chọn assignment_id"}).click();assert.equal(await p.locator("#id").inputValue(),x);await p.locator("#run").click();await p.waitForFunction(()=>document.querySelector("#output").textContent.includes("essay"));assert.equal(errors.length,0);await p.locator("#clear").click();assert.equal(await p.locator("#output").textContent(),"");}finally{await browser.close();}}
async function staff(role,op,id=null,b={}){if(role==="ci_exam_a"){const r=await deskCall(op,id,b);if(r.status!==200)throw Error("Desk operation refused");return r.data.data;}return (await db[role].query("SELECT vpo_stage.demo_staff_action($1,$2::uuid,$3::jsonb) AS value",[op,id,JSON.stringify(b)])).rows[0].value;}
async function call(path,method="GET",s=null,b){const headers={};if(method!=="GET")headers.Origin=base;if(s){headers.Cookie=s.cookie;headers["X-CSRF-Token"]=s.csrf;}if(b!==undefined)headers["Content-Type"]="application/json";const r=await fetch(base+path,{method,headers,body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(15000),redirect:"error"});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")};}
async function login(email,password){const r=await call("/auth/login","POST",null,{email,password});assert.equal(r.status,200);return {cookie:r.cookie.split(";")[0],csrf:r.data.csrf};}
async function main(){
 try{
  for(const role of roles){db[role]=new Client({connectionString:e["VPO_DB_"+role],statement_timeout:10000,connectionTimeoutMillis:3000});await db[role].connect();assert.equal((await db[role].query("SELECT session_user AS u")).rows[0].u,role);}
  await startDesk();
  const a=await login(e.VPO_TEST_A_EMAIL,e.VPO_TEST_A_PASSWORD),b=await login(e.VPO_TEST_B_EMAIL,e.VPO_TEST_B_PASSWORD);
  const x=(await staff("ci_exam_a","queue"))[0].assignment_id,y=(await staff("ci_exam_b","queue"))[0].assignment_id;
  await browserDesk(x);
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
  console.log("V6 staff desk PASS: browser queue/read, wrong token/origin/role denied, cross-assignment denied, actual mark lock and duplicate refusal via HTTP.");
  console.log("Workflow synthetic smoke passed.");
 }finally{if(desk){desk.kill("SIGTERM");await new Promise(r=>{if(desk.exitCode!==null)r();else desk.once("exit",r);});}await Promise.all(Object.values(db).map(x=>x.end().catch(()=>{})));}
}
main().catch(e=>{console.error("Workflow smoke failed:",e.code||e.name);process.exitCode=1;});