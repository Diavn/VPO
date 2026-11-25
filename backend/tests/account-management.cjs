"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{randomBytes}=require("node:crypto"),{chromium}=require("playwright");
const e=process.env,base="http://localhost:8082",student="http://localhost:8080";
if(e.VPO_MODE!=="synthetic-staging"||e.VPO_ORIGIN!==student||!(e.GITHUB_ACTIONS==="true"||e.CODESPACES==="true")||!e.VPO_TEST_MAIL_DIR||!e.VPO_TEST_ADMIN_PASSWORD)throw Error("Synthetic local fixture required");
async function call(p,b,token="",origin=base,host=base){const r=await fetch(host+p,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(b),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")};}
async function main(){
 const email="new-"+randomBytes(6).toString("hex")+"@example.test",password=randomBytes(24).toString("hex");
 const login=()=>call("/auth/login",{email,password},"",student,student);
 assert.equal((await call("/api/admin/users",{search:""})).status,401);
 assert.equal((await call("/api/register/request",{email},"","http://foreign.example.test")).status,403);
 assert.equal((await call("/api/register/request",{email:"real@example.com"})).status,422);
 const first=await call("/api/register/request",{email});assert.equal(first.status,202);assert(!("code" in first.data));
 const id=first.data.challenge_id,mail=JSON.parse(fs.readFileSync(path.join(e.VPO_TEST_MAIL_DIR,id+".json"),"utf8"));assert.equal(mail.to,email);assert.match(mail.code,/^\d{8}$/);
 assert.equal((await login()).status,401);
 const bad=(mail.code==="00000000"?"11111111":"00000000");
 assert.equal((await call("/api/register/verify",{challenge_id:id,code:bad,password})).status,400);
 assert.equal((await call("/api/register/verify",{challenge_id:id,code:mail.code,password})).status,201);
 assert.equal((await call("/api/register/verify",{challenge_id:id,code:mail.code,password})).status,400);
 assert(!fs.existsSync(path.join(e.VPO_TEST_MAIL_DIR,id+".json")));
 const a=await login();assert.equal(a.status,200);
 const admin=await call("/api/admin/login",{username:"admin",password:e.VPO_TEST_ADMIN_PASSWORD});assert.equal(admin.status,200);const t=admin.data.token;
 const list=await call("/api/admin/users",{search:email},t);assert.equal(list.status,200);assert.equal(list.data.data.length,1);const u=list.data.data[0];assert(u.email_verified_at);assert.equal(u.status,"ACTIVE");assert(!("password_hash" in u));
 const browser=await chromium.launch({headless:true});try{const p=await browser.newPage({viewport:{width:390,height:844}});await p.goto(base+"/admin");await p.locator("#password").fill(e.VPO_TEST_ADMIN_PASSWORD);await p.locator("#signin").click();await p.locator("#workspace").waitFor({state:"visible"});await p.locator("#search").fill(email);await p.locator("#find").click();await p.getByText(email,{exact:false}).first().waitFor();assert.equal(await p.getByRole("button",{name:"Xóa user",exact:true}).count(),1);await p.locator("#logout").click();await p.locator("#login").waitFor({state:"visible"});}finally{await browser.close();}
 const reauth=await call("/api/admin/login",{username:"admin",password:e.VPO_TEST_ADMIN_PASSWORD});assert.equal(reauth.status,200);const t2=reauth.data.token;
 const change=op=>call("/api/admin/change",{id:u.id,op},t2);
 assert.equal((await change("suspend")).status,200);
 const session=await fetch(student+"/me",{headers:{Cookie:a.cookie.split(";")[0]}});assert.equal(session.status,401);
 assert.equal((await login()).status,401);
 assert.equal((await change("activate")).status,200);assert.equal((await login()).status,200);
 assert.equal((await change("delete")).status,200);assert.equal((await change("activate")).status,409);
 const deleted=await call("/api/admin/users",{search:email},t2);assert.equal(deleted.data.data[0].status,"DELETED");
 const invite=await call("/api/admin/invite",{email:"invite-"+randomBytes(6).toString("hex")+"@example.test"},t2);assert.equal(invite.status,202);assert(fs.existsSync(path.join(e.VPO_TEST_MAIL_DIR,invite.data.challenge_id+".json")));
 assert.equal((await call("/api/admin/logout",{},t2)).status,200);assert.equal((await call("/api/admin/users",{search:""},t2)).status,401);
 console.log("V6.1 account lifecycle PASS: synthetic delivery, pre-verification denied, wrong code/replay denied, admin browser, session invalidation, activate/delete and invite.");
}
main().catch(err=>{console.error("Account lifecycle failed:",err.code||err.name);process.exitCode=1;});