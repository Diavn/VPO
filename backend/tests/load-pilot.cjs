"use strict";
// Bounded load test on disposable local CI fixtures ONLY; never a public endpoint.
const assert=require("node:assert/strict"),{Client}=require("pg"),{randomUUID,randomBytes}=require("node:crypto"),{performance}=require("node:perf_hooks"),S=require("../security.cjs");
const e=process.env,base="http://localhost:8080";
if((e.GITHUB_ACTIONS!=="true"&&e.CODESPACES!=="true")||e.VPO_CI_DISPOSABLE!=="yes"||e.VPO_MODE!=="synthetic-staging"||e.VPO_ORIGIN!==base)throw Error("Disposable local test only");
const N=24; // pilot only; official concurrency N not approved.
const ms={};const record=(k,t)=>(ms[k]??=[]).push(t);
async function call(k,path,method="GET",s=null,b){
 const headers={};if(method!=="GET")headers.Origin=base;if(s){headers.Cookie=s.cookie;headers["X-CSRF-Token"]=s.csrf;}if(b!==undefined)headers["Content-Type"]="application/json";
 const t=performance.now();const r=await fetch(base+path,{method,headers,body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(15000),redirect:"error"});const data=await r.json();record(k,performance.now()-t);return {status:r.status,data,cookie:r.headers.get("set-cookie")};
}
function report(){for(const [k,v] of Object.entries(ms)){v.sort((a,b)=>a-b);const p=x=>Math.round(v[Math.ceil(x*v.length)-1]);console.log("LOAD",JSON.stringify({phase:k,n:v.length,p50_ms:p(.5),p95_ms:p(.95),max_ms:p(1)}));}}
async function main(){
 const db=new Client({connectionString:e.VPO_CI_OWNER_DB,statement_timeout:10000});await db.connect();
 try{
 const password=randomBytes(24).toString("hex"),hash=await S.hashPassword(password);
 const round=(await db.query("INSERT INTO vpo_stage.demo_rounds(label,opens_at,closes_at,duration_seconds,topic) VALUES('DEMO load pilot',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '15 minutes',600,'Synthetic load question') RETURNING id")).rows[0].id;
 const learners=[];
 await db.query("BEGIN");
 try{for(let i=0;i<N;i++){
 const email="load-"+randomUUID()+"@example.test";
 const id=(await db.query("INSERT INTO vpo_stage.users(email,password_hash,status) VALUES($1,$2,'ACTIVE') RETURNING id",[email,hash])).rows[0].id;
 await db.query("INSERT INTO vpo_stage.role_grants(user_id,role) VALUES($1,'student')",[id]);
 await db.query("INSERT INTO vpo_stage.student_profiles(user_id,student_code,name_vi,name_latin,grade,curriculum,locale) VALUES($1,$2,'DEMO','DEMO','11','DEMO-VN','vi')",[id,"DEMO-"+randomUUID()]);
 await db.query("INSERT INTO vpo_stage.demo_enrolments(round_id,user_id) VALUES($1,$2)",[round,id]);learners.push({id,email});
 }await db.query("COMMIT");}catch(err){await db.query("ROLLBACK");throw err;}
 // Logins intentionally sequential: existing global hash/rate limits not a load capacity claim.
 for(const u of learners){const r=await call("login","/auth/login","POST",null,{email:u.email,password});assert.equal(r.status,200);u.cookie=r.cookie.split(";")[0];u.csrf=r.data.csrf;}
 await Promise.all(learners.map(async u=>{const r=await call("start","/rounds/"+round+"/attempts","POST",u);assert.equal(r.status,201);u.attempt=r.data.id;}));
 for(let seq=0;seq<4;seq++){
 await Promise.all(learners.map(async u=>{
 const b={expected_seq:seq,op_id:randomUUID(),body:("Synthetic "+u.id+" revision "+(seq+1)+". ").repeat(40)};
 const path="/attempts/"+u.attempt+"/draft";const r=await call("save",path,"PUT",u,b);assert.equal(r.status,200);assert.equal(r.data.ack_seq,seq+1);u.last=b;
 }));}
 // Replay all final acknowledged saves, then simultaneous manual submissions.
 await Promise.all(learners.map(async u=>{const r=await call("retry","/attempts/"+u.attempt+"/draft","PUT",u,u.last);assert.equal(r.status,200);assert.equal(r.data.replayed,true);assert.equal(r.data.ack_seq,4);}));
 await Promise.all(learners.map(async u=>{const r=await call("submit","/attempts/"+u.attempt+"/submit","POST",u,{expected_seq:4});assert.equal(r.status,201);assert.equal(r.data.receipt.seq,4);u.receipt=r.data.receipt.receipt_id;}));
 await Promise.all(learners.map(async u=>{const r=await call("receipt_replay","/attempts/"+u.attempt+"/submit","POST",u,{expected_seq:4});assert.equal(r.status,200);assert.equal(r.data.receipt.receipt_id,u.receipt);}));
 const rows=(await db.query("SELECT a.id,a.state,a.latest_seq,s.seq,s.receipt_id,d.body,(SELECT count(*)::int FROM vpo_stage.demo_drafts x WHERE x.attempt_id=a.id) AS revisions FROM vpo_stage.demo_attempts a JOIN vpo_stage.demo_submissions s ON s.attempt_id=a.id JOIN vpo_stage.demo_drafts d ON d.attempt_id=a.id AND d.seq=s.seq WHERE a.round_id=$1",[round])).rows;
 assert.equal(rows.length,N);for(const u of learners){const r=rows.find(x=>x.id===u.attempt);assert(r);assert.equal(r.state,"SUBMITTED");assert.equal(r.latest_seq,4);assert.equal(r.seq,4);assert.equal(r.revisions,5);assert.equal(r.body,u.last.body);assert.equal(r.receipt_id,u.receipt);}
 report();
 console.log("LOAD integrity PASS: 24 users, 96 new acknowledged drafts, 24 replayed saves, 24 unique receipts, zero mismatched final essays.");
 // Pilot latency targets only, not official service level.
 for(const k of ["save","submit"]){const v=ms[k].slice().sort((a,b)=>a-b);assert(v[Math.ceil(.95*v.length)-1]<=(k==="save"?2000:3000),k+" pilot p95 exceeded");}
 }finally{await db.end();}
}
main().catch(err=>{console.error("Load pilot failed:",err.code||err.name);process.exitCode=1;});