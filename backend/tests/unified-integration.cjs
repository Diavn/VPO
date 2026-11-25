"use strict";
// Browser runs through gateway; internal services are never used by this browser.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{randomBytes}=require("node:crypto"),{chromium}=require("playwright"),{Client}=require("pg"),http=require("node:http");
const e=process.env,base="http://localhost:8091";
if(e.VPO_MODE!=="synthetic-staging"||e.VPO_CI_DISPOSABLE!=="yes"||!e.VPO_TEST_MAIL_DIR||!(e.GITHUB_ACTIONS==="true"||e.CODESPACES==="true"))throw Error("Disposable test only");
async function main(){
 // Check raw header multiplicity, not only the combined fetch header.
 const raw=await new Promise((resolve,reject)=>{http.get(base+"/register",r=>{r.resume();r.on("end",()=>resolve(r.rawHeaders));}).on("error",reject);});
 const policies=raw.filter((x,i)=>i%2===0&&x.toLowerCase()==="content-security-policy");assert.equal(policies.length,1,"Gateway must send one CSP header");
 const register=await fetch(base+"/register");const csp=register.headers.get("content-security-policy");assert.match(csp,/connect-src 'self'/);assert(!csp.includes("connect-src 'none'"));await register.text();
 const ok=await fetch(base+"/healthz");assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{mode:"synthetic-staging",student:200,accounts:200});
 for(const p of ["/backend/schema.sql","/.git/config","/VPO/../backend/schema.sql","/VPO/%2e%2e/backend/security.cjs","/api/admin/unknown","/api/action"])assert.equal((await fetch(base+p)).status,404);
 const bad=await fetch(base+"/api/admin/login",{method:"POST",headers:{Origin:"http://foreign.example.test","Content-Type":"application/json"},body:"{}"});assert.equal(bad.status,403);
 // First isolate the HTTP gateway from browser behavior, without consuming a real email.
 const probeEmail="gateway-probe-"+randomBytes(6).toString("hex")+"@example.test";
 const probe=await fetch(base+"/api/register/request",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({email:probeEmail})});
 const probeResult=await probe.json();assert.equal(probe.status,202,"Gateway registration HTTP status "+probe.status+" / "+(probeResult.error||"none"));assert.match(probeResult.challenge_id,/^[a-f0-9-]{36}$/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(e.VPO_TEST_MAIL_DIR,probeResult.challenge_id+".json"),"utf8")).to,probeEmail);
 console.log("UNIFIED REGISTRATION HTTP PASS");
 const b=await chromium.launch({headless:true});try{
 const ctx=await b.newContext({viewport:{width:390,height:844}});await ctx.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const p=await ctx.newPage(),errors=[];p.on("console",m=>{if(m.type()==="error"){const t=m.text();if(/Content Security Policy|Refused to connect|Failed to load resource/.test(t))console.log("Unified browser console: "+(t.includes("Content Security Policy")?"CSP":t.includes("Refused to connect")?"CONNECT":"RESOURCE"));}});p.on("pageerror",err=>errors.push(err.name));p.on("response",r=>{if(r.status()>=400&&!r.url().endsWith("/me"))errors.push("HTTP "+r.status()+" "+new URL(r.url()).pathname);});
 await p.goto(base);assert.equal(new URL(p.url()).pathname,"/VPO/index.html");
 for(const name of ["about","competition","results","knowledge","library","academy","community","news","support"]){await p.goto(base+"/VPO/"+name+".html");assert.equal(await p.locator("main").count(),1);}
 await p.goto(base);await p.getByRole("link",{name:"My VPO",exact:true}).first().click();await p.waitForURL(base+"/staging");await p.locator("#login").waitFor({state:"visible"});
 async function postClick(button,route,status){
  let response;
  try{[response]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname===route&&r.request().method()==="POST",{timeout:18000}),p.locator(button).click()]);}
  catch{const visible=(await p.locator("#status").textContent().catch(()=>""))||"";const code=visible.match(/Không hoàn tất: ([A-Z0-9_ ]{1,80})/);throw Error("No POST response for "+route+" / "+(code?code[1]:"check JS/CSP/request logs"));}
  if(response.status()!==status){const j=await response.json().catch(()=>({}));throw Error(route+" HTTP "+response.status()+" / "+(/^[A-Z0-9_]{1,80}$/.test(j.error||"")?j.error:"UNKNOWN"));}
  return response;
 }
 await p.goto(base+"/register");const email="unified-"+randomBytes(6).toString("hex")+"@example.test",pass=randomBytes(24).toString("hex");await p.locator("#email").fill(email);await postClick("#request","/api/register/request",202);await p.waitForFunction(()=>document.querySelector("#challenge").value.length===36);
 const id=await p.locator("#challenge").inputValue(),mail=JSON.parse(fs.readFileSync(path.join(e.VPO_TEST_MAIL_DIR,id+".json"),"utf8"));assert.equal(mail.to,email);await p.locator("#code").fill(mail.code);await p.locator("#newpass").fill(pass);await postClick("#verify","/api/register/verify",201);await p.getByText("Tài khoản mẫu đã kích hoạt.",{exact:false}).waitFor();
 await p.goto(base+"/staging");await p.waitForFunction(()=>!document.querySelector("#login").disabled);await p.locator("#email").fill(email);await p.locator("#password").fill(pass);await p.locator("#login").click();await p.locator("#dashboard").waitFor({state:"visible"});
 assert((await ctx.cookies()).some(c=>c.name==="vpo_local_session"&&c.httpOnly));assert.equal((await ctx.request.get(base+"/me")).status(),200);
 await p.goto(base+"/admin");await p.locator("#password").fill(e.VPO_TEST_ADMIN_PASSWORD);await postClick("#signin","/api/admin/login",200);await p.locator("#workspace").waitFor({state:"visible"});await p.locator("#search").fill(email);await p.locator("#find").click();await p.waitForFunction(()=>document.querySelectorAll("#users .user").length===1);await p.getByText(email,{exact:false}).first().waitFor();await p.locator("#logout").click();await p.locator("#login").waitFor({state:"visible"});
 // Separate admin logout must not remove the student session.
 assert.equal((await ctx.request.get(base+"/me")).status(),200);
 // Explicit synthetic enrolments by fixture owner only, never student self-enrolment.
 const db=new Client({connectionString:e.VPO_CI_OWNER_DB,statement_timeout:10000,connectionTimeoutMillis:3000});let round;
 try{await db.connect();const role=(await db.query("SELECT current_database() AS db,session_user AS role")).rows[0];assert.deepEqual(role,{db:"vpo_ci",role:"vpo_migrator"});
 const uid=(await db.query("SELECT id FROM vpo_stage.users WHERE email=$1 AND email_verified_at IS NOT NULL",[email])).rows[0].id;
 round=(await db.query("INSERT INTO vpo_stage.demo_rounds(label,opens_at,closes_at,duration_seconds,topic) VALUES('DEMO unified round',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '10 minutes',180,'Synthetic unified question') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO vpo_stage.demo_enrolments(round_id,user_id) VALUES($1,$2)",[round,uid]);
 const en=await db.query("INSERT INTO vpo_stage.academy_enrolments(course_id,user_id,mentor) SELECT course_id,$1,mentor FROM vpo_stage.academy_enrolments WHERE id=$2 RETURNING id",[uid,e.VPO_TEST_ACADEMY_ENROLMENT]);assert.equal(en.rowCount,1);
 }finally{await db.end();}
 await p.goto(base+"/staging");await p.locator("#dashboard").waitFor({state:"visible"});
 await p.locator('a[href="/exam-demo"]').click();await p.waitForURL(base+"/exam-demo");
 await p.locator("#email").fill(email);await p.locator("#password").fill(pass);await p.locator("#login").click();await p.waitForFunction(()=>!document.querySelector("#preflight").disabled);
 await p.locator("#round").fill(round);await p.locator("#preflight").click();await p.waitForFunction(()=>!document.querySelector("#start").disabled);await p.locator("#start").click();await p.waitForFunction(()=>!document.querySelector("#essay").disabled);
 await p.locator("#essay").fill("Synthetic gateway examination essay.");await p.locator("#save").click();await p.waitForFunction(()=>/xác nhận bản #1/.test(document.querySelector("#save-status").textContent));p.once("dialog",d=>d.accept());await p.locator("#submit").click();await p.waitForFunction(()=>document.querySelector("#state").textContent==="SUBMITTED");assert.match(await p.locator("#receipt-output").textContent(),/"seq": 1/);
 await p.goto(base+"/staging");await p.locator("#dashboard").waitFor({state:"visible"});
 await p.locator('a[href="/academy-demo"]').click();await p.waitForURL(base+"/academy-demo");
 await p.locator("#email").fill(email);await p.locator("#password").fill(pass);await p.locator("#login").click();await p.locator("#portfolio").waitFor({state:"visible"});
 assert.equal(await p.locator("#lessons article").count(),6);assert.equal(await p.locator("#tasks article").count(),3);
 await p.locator('[data-action="complete"]').first().click();await p.getByText("Đã tự báo hoàn thành",{exact:true}).first().waitFor();await p.locator("#logout").click();await p.locator("#portfolio").waitFor({state:"hidden"});
 console.log("UNIFIED EXAM/ACADEMY PASS: enrolled synthetic student, save/receipt, course and completion through gateway.");
 await p.goto(base+"/staging");await p.locator("#login-panel").waitFor({state:"visible"});
 assert.equal((await ctx.request.get(base+"/me")).status(),401);
 assert.deepEqual(errors,[]);
 console.log("UNIFIED PORTAL PASS: ten public pages, My VPO navigation, browser OTP registration, student login, admin search/logout, separated student session, blocked unknown paths/origin.");
 }finally{await b.close();}
}
main().catch(err=>{console.error("Unified portal failed:",err.code||err.name,err.message.startsWith("No POST response")||err.message.startsWith("/api/")||err.message.startsWith("Gateway registration HTTP")?err.message:"",typeof err.actual==="number"&&typeof err.expected==="number"?("actual="+err.actual+" expected="+err.expected):"",String(err.stack||"").split("\n").find(x=>x.includes("unified-integration.cjs:"))||"");process.exitCode=1;});