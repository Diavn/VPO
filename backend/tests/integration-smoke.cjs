"use strict";
// Run ONLY against the isolated synthetic staging server with two provisioned fake accounts.
// Credentials supplied by a private environment, never CLI arguments or Git.
const assert=require("node:assert/strict");
const base=process.env.VPO_ORIGIN;
if(process.env.VPO_MODE!=="synthetic-staging"||!/^http:\/\/localhost:\d+$/.test(base||""))throw Error("Local synthetic staging only");
const aEmail=process.env.VPO_TEST_A_EMAIL,bEmail=process.env.VPO_TEST_B_EMAIL;
const aPass=process.env.VPO_TEST_A_PASSWORD,bPass=process.env.VPO_TEST_B_PASSWORD;
if(!aEmail?.endsWith("@example.test")||!bEmail?.endsWith("@example.test")||aEmail===bEmail||!aPass||!bPass)throw Error("Two different synthetic accounts required");
async function call(path,{method="GET",body,session,csrf=true,origin=base}={}){
 const headers={};if(method!=="GET")headers.Origin=origin;if(body!==undefined)headers["Content-Type"]="application/json";if(session){headers.Cookie=session.cookie;if(csrf)headers["X-CSRF-Token"]=session.csrf;}
 const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(10000)});return {status:res.status,body:await res.json(),cookie:res.headers.get("set-cookie"),cache:res.headers.get("cache-control")};
}
async function login(email,password){const r=await call("/auth/login",{method:"POST",body:{email,password}});assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);assert.equal(r.cache,"no-store");return {cookie:r.cookie.split(";")[0],csrf:r.body.csrf};}
async function main(){
 assert.equal((await call("/healthz")).status,200);
 assert.equal((await call("/me")).status,401);
 assert.equal((await call("/auth/login",{method:"POST",origin:"http://untrusted.example.test",body:{email:aEmail,password:aPass}})).status,403);
 const a=await login(aEmail,aPass),b=await login(bEmail,bPass);
 const ap=(await call("/me",{session:a})).body.profile,bp=(await call("/me",{session:b})).body.profile;
 assert(ap&&bp);assert.notEqual(ap.student_code,bp.student_code);
 const patch={grade:ap.grade==="10"?"11":"10",curriculum:ap.curriculum,locale:ap.locale,version:ap.version};
 assert.equal((await call("/me/profile",{method:"PATCH",body:patch,session:a,csrf:false})).status,403);
 assert.equal((await call("/me/profile",{method:"PATCH",body:patch,session:{...a,csrf:b.csrf}})).status,403);
 assert.equal((await call("/me/profile",{method:"PATCH",body:{...patch,user_id:bp.student_code},session:a})).status,422);
 const changed=await call("/me/profile",{method:"PATCH",body:patch,session:a});assert.equal(changed.status,200);assert.equal(changed.body.profile.version,ap.version+1);
 assert.equal((await call("/me/profile",{method:"PATCH",body:patch,session:a})).status,409);
 const unchanged=(await call("/me",{session:b})).body.profile;assert.deepEqual(unchanged,bp);
 assert.equal((await call("/auth/register",{method:"POST",body:{email:"third@example.test"}})).status,404);
 assert.equal((await call("/me/evidence",{method:"POST",session:a,body:{}})).status,404);
 assert.equal((await call("/auth/logout",{method:"POST",session:a})).status,200);
 assert.equal((await call("/me",{session:a})).status,401);
 assert.equal((await call("/auth/logout",{method:"POST",session:b})).status,200);
 console.log("Local integration smoke scenarios passed");
}
main().catch(()=>{console.error("Integration smoke failed; inspect staging diagnostics without logging secrets.");process.exitCode=1;});