"use strict";
// Disposable synthetic rounds only. Mutates and submits A's exam.
const assert=require("node:assert/strict"),{randomUUID}=require("node:crypto");
const env=process.env,base=env.VPO_ORIGIN;
if(env.VPO_MODE!=="synthetic-staging"||!/^http:\/\/localhost:\d+$/.test(base||""))throw Error("Local staging only");
const round=env.VPO_TEST_ROUND;
if(!/^[a-f0-9-]{36}$/i.test(round||""))throw Error("Set fresh round UUID");
if(!env.VPO_TEST_A_EMAIL?.endsWith("@example.test")||!env.VPO_TEST_B_EMAIL?.endsWith("@example.test")||env.VPO_TEST_A_EMAIL===env.VPO_TEST_B_EMAIL)throw Error("Two fake accounts required");
async function call(path,method="GET",s=null,b,withCsrf=true){
 const headers={};if(method!=="GET")headers.Origin=base;if(s){headers.Cookie=s.cookie;if(withCsrf)headers["X-CSRF-Token"]=s.csrf;}
 if(b!==undefined)headers["Content-Type"]="application/json";
 const r=await fetch(base+path,{method,headers,body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(15000),redirect:"error"});
 return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")};
}
async function login(email,password){const r=await call("/auth/login","POST",null,{email,password});assert.equal(r.status,200);return {cookie:r.cookie.split(";")[0],csrf:r.data.csrf};}
async function main(){
 const a=await login(env.VPO_TEST_A_EMAIL,env.VPO_TEST_A_PASSWORD),b=await login(env.VPO_TEST_B_EMAIL,env.VPO_TEST_B_PASSWORD);
 const pre=await call("/rounds/"+round+"/preflight","GET",a);assert.equal(pre.status,200);assert.equal(pre.data.may_start,true);assert(!("topic" in pre.data));
 assert.equal((await call("/rounds/"+round+"/attempts","POST",b)).status,404);
 const starts=await Promise.all([call("/rounds/"+round+"/attempts","POST",a),call("/rounds/"+round+"/attempts","POST",a)]);
 assert.deepEqual(starts.map(x=>x.status).sort(),[200,201]);assert.equal(starts[0].data.id,starts[1].data.id);
 const root="/attempts/"+starts[0].data.id;
 assert.equal((await call(root+"/topics","GET",b)).status,404);assert.equal((await call(root+"/topics","GET",a)).status,200);
 assert.equal((await call(root+"/draft","GET",b)).status,404);
 const op={expected_seq:0,op_id:randomUUID(),body:"Synthetic essay A"};
 assert.equal((await call(root+"/draft","PUT",a,op,false)).status,403);
 const writes=await Promise.all([call(root+"/draft","PUT",a,op),call(root+"/draft","PUT",a,{...op,op_id:randomUUID(),body:"Competing draft"})]);
 assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
 const d=await call(root+"/draft","GET",a);assert.equal(d.data.draft.seq,1);
 const next={expected_seq:1,op_id:randomUUID(),body:"Synthetic revision 2"};
 const save=await call(root+"/draft","PUT",a,next);assert.equal(save.status,200);assert.equal(save.data.ack_seq,2);
 const replay=await call(root+"/draft","PUT",a,next);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.latest_seq,2);
 assert.equal((await call(root+"/draft","PUT",a,{...next,body:"Different"})).status,409);
 assert.equal((await call(root+"/submit","POST",a,{expected_seq:1})).status,409);
 const event={event_id:randomUUID(),kind:"HIDDEN"};assert.equal((await call(root+"/events","POST",a,event)).status,202);
 assert.equal((await call(root+"/events","POST",a,event)).data.replayed,true);
 const submits=await Promise.all([call(root+"/submit","POST",a,{expected_seq:2}),call(root+"/submit","POST",a,{expected_seq:2})]);
 assert.deepEqual(submits.map(x=>x.status).sort(),[200,201]);assert.equal(submits[0].data.receipt.receipt_id,submits[1].data.receipt.receipt_id);
 assert.equal((await call(root+"/draft","PUT",a,{expected_seq:2,op_id:randomUUID(),body:"Late"})).status,410);
 assert.equal((await call(root+"/receipt","GET",b)).status,404);
 const receipt=await call(root+"/receipt","GET",a);assert.equal(receipt.data.receipt.seq,2);
 console.log("Exam HTTP smoke passed; deadline worker not covered.");
}
main().catch(()=>{console.error("Exam integration failed; inspect staging diagnostics without revealing credentials.");process.exitCode=1;});
