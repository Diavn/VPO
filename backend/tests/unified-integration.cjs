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
 assert.equal((await fetch(base+"/me/rounds")).status,401);
 const bad=await fetch(base+"/api/admin/login",{method:"POST",headers:{Origin:"http://foreign.example.test","Content-Type":"application/json"},body:"{}"});assert.equal(bad.status,403);
 for(const route of ["overview","rounds","audit","round-create","enrol","content-list","content-save","content-transition","question-list","question-add","round-from-question","academy-catalog","academy-enrol"]){const denied=await fetch(base+"/api/admin/"+route,{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:"{}"});assert.equal(denied.status,401);}
 async function adminCall(route,body,token){const r=await fetch(base+"/api/admin/"+route,{method:"POST",headers:{Origin:base,"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json()};}
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
 await p.goto(base+"/admin");await p.locator("#password").fill(e.VPO_TEST_ADMIN_PASSWORD);const adminResponse=await postClick("#signin","/api/admin/login",200),adminToken=(await adminResponse.json()).token;await p.locator("#workspace").waitFor({state:"visible"});
 assert.equal(await p.locator("#overview .metric").count(),8);
 await p.locator("#search").fill(email);await p.locator("#find").click();await p.waitForFunction(()=>document.querySelectorAll("#users .user").length===1);await p.locator("#users .user").getByText(email,{exact:false}).waitFor();
 const dates=await p.evaluate(()=>{function fmt(n){const d=new Date(n);return new Date(n-d.getTimezoneOffset()*60000).toISOString().slice(0,19);}return {open:fmt(Date.now()-30000),close:fmt(Date.now()+600000)};});
 const qcode="DEMO-Q-"+randomBytes(4).toString("hex").toUpperCase(),qtopic="Synthetic unified question";
 await p.locator("#question-code").fill(qcode);await p.locator("#question-topic").fill(qtopic);p.once("dialog",d=>d.accept());
 const qresponse=await postClick("#question-add","/api/admin/question-add",201),qpayload=qresponse.request().postDataJSON();
 await p.waitForFunction(id=>document.querySelector("#round-question").value===id,qpayload.id);
 assert.equal((await adminCall("question-add",qpayload,adminToken)).status,200);
 assert.equal((await adminCall("question-add",{...qpayload,topic:"Conflicting synthetic question"},adminToken)).status,409);
 const q2={...qpayload,id:require("node:crypto").randomUUID(),version:2,topic:"New version of synthetic question"};
 assert.equal((await adminCall("question-add",q2,adminToken)).status,201);
 const label="DEMO admin-created round "+randomBytes(4).toString("hex");
 await p.locator("#round-label").fill(label);await p.locator("#round-open").fill(dates.open);await p.locator("#round-close").fill(dates.close);await p.locator("#round-duration").fill("180");await p.locator("#round-topic").fill("Synthetic unified question");
 p.once("dialog",d=>d.accept());const created=await postClick("#create-round","/api/admin/round-from-question",201);const round=(await created.json()).id,roundPayload=created.request().postDataJSON();
 const replays=await Promise.all([adminCall("round-from-question",roundPayload,adminToken),adminCall("round-from-question",roundPayload,adminToken)]);for(const r of replays){assert.equal(r.status,200);assert.equal(r.data.id,round);assert.equal(r.data.result,"REPLAY");}assert.equal((await adminCall("round-from-question",{...roundPayload,question_id:q2.id},adminToken)).status,409);
 await p.waitForFunction(id=>document.querySelector("#enrol-round").value===id,round);
 p.once("dialog",d=>d.accept());await postClick("#users button:text-is('Ghi danh')","/api/admin/enrol",201);
 await p.waitForFunction(()=>document.querySelector("#status").textContent==="Đã ghi danh.");
 p.once("dialog",d=>d.accept());await postClick("#users button:text-is('Ghi danh')","/api/admin/enrol",200);
 await p.waitForFunction(()=>document.querySelector("#status").textContent==="Đã ghi danh trước đó.");
 const users=await adminCall("users",{search:email},adminToken);assert.equal(users.status,200);const uid=users.data.data[0].id;
 const listed=await adminCall("rounds",{},adminToken);const record=listed.data.data.find(x=>x.id===round);assert.equal(record.enrolments,1);assert(!("topic" in record));
 const journal=await adminCall("audit",{},adminToken);assert.equal(journal.data.data.filter(x=>x.action==="ENROLLED"&&x.round_id===round&&x.user_id===uid).length,1);assert.equal(journal.data.data.filter(x=>x.action==="ROUND_CREATED"&&x.round_id===round).length,1);
 assert.equal((await adminCall("round-create",{label:"invalid",opens_at:new Date().toISOString(),closes_at:new Date(Date.now()+600000).toISOString(),duration_seconds:60,topic:"x"},adminToken)).status,422);
 const fake=await adminCall("users",{search:e.VPO_TEST_B_EMAIL},adminToken);assert.equal((await adminCall("enrol",{user_id:fake.data.data[0].id,round_id:round},adminToken)).status,409);
 const catalog=(await adminCall("academy-catalog",{},adminToken)).data.data;assert(catalog.courses.length&&catalog.mentors.length);
 const course_id=catalog.courses[0].id,mentor=catalog.mentors[0];
 await p.locator("#academy-course").selectOption(course_id);await p.locator("#academy-mentor").selectOption(mentor);
 p.once("dialog",d=>d.accept());await postClick("#users button:text-is('Ghi danh Academy')","/api/admin/academy-enrol",201);
 await p.waitForFunction(()=>document.querySelector("#status").textContent==="Đã ghi danh Academy.");
 const duplicate=await adminCall("academy-enrol",{user_id:uid,course_id,mentor},adminToken);assert.equal(duplicate.status,200);assert.equal(duplicate.data.result,"EXISTS");
 assert.equal((await adminCall("academy-enrol",{user_id:fake.data.data[0].id,course_id,mentor},adminToken)).status,409);
 const academicAudit=(await adminCall("audit",{},adminToken)).data.data;
 assert.equal(academicAudit.filter(x=>x.action==="QUESTION_CREATED"&&x.question_version_id===qpayload.id).length,1);
 assert(academicAudit.some(x=>x.action==="ROUND_CREATED"&&x.round_id===round&&x.question_version_id===qpayload.id));
 assert.equal(academicAudit.filter(x=>x.action==="ACADEMY_ENROLLED"&&x.user_id===uid&&x.course_id===course_id).length,1);
 console.log("ACADEMIC ADMIN PASS: immutable question version creation and replay, version-specific round, browser Academy enrolment, duplicate and unverified denial, audit.");
 const title="DEMO bulletin "+randomBytes(4).toString("hex"),literal="<b>Plain text only</b>";
 await p.locator("#content-title").fill(title);await p.locator("#content-body").fill(literal);
 await postClick("#content-save","/api/admin/content-save",201);
 await p.waitForFunction(()=>document.querySelector("#content-status").textContent.includes("Đã lưu"));
 const entries=await adminCall("content-list",{},adminToken);const entry=entries.data.data.find(v=>v.title===title);assert.equal(entry.state,"DRAFT");
 const publicList=async()=>{const r=await fetch(base+"/api/public/content");assert.equal(r.status,200);return (await r.json()).data;};
 assert(!(await publicList()).some(v=>v.id===entry.id));
 await p.locator("#content-body").fill(literal+"\nRevised");await postClick("#content-save","/api/admin/content-save",200);
 await p.waitForFunction(()=>document.querySelector("#content-status").textContent.includes("#2"));
 assert.equal((await adminCall("content-save",{id:entry.id,category:"NEWS",title,body:"stale conflicting update",revision:1},adminToken)).status,409);
 p.once("dialog",d=>d.accept());await postClick("#content-list button:text-is('Công bố mẫu')","/api/admin/content-transition",200);
 await p.waitForFunction(()=>document.querySelector("#content-list").textContent.includes("PUBLISHED"));
 const preview=await ctx.newPage();try{await preview.goto(base+"/bulletin");await preview.getByRole("heading",{name:title,exact:true}).waitFor();assert.equal(await preview.locator("#bulletin b").count(),0);assert.equal(await preview.locator("#bulletin .content-body").textContent(),literal+"\nRevised");}finally{await preview.close();}
 assert.equal((await adminCall("content-save",{id:entry.id,category:"NEWS",title,body:"edit published",revision:3},adminToken)).status,409);
 p.once("dialog",d=>d.accept());await postClick("#content-list button:text-is('Gỡ công bố')","/api/admin/content-transition",200);
 await p.waitForFunction(()=>document.querySelector("#content-list").textContent.includes("WITHDRAWN"));assert(!(await publicList()).some(v=>v.id===entry.id));
 console.log("CMS PASS: browser draft/edit/publish/withdraw, draft isolation, stale revision and published edit denied, literal text rendering.");
 await p.locator("#logout").click();await p.locator("#login").waitFor({state:"visible"});assert.equal((await adminCall("audit",{},adminToken)).status,401);
 console.log("ADMIN CENTER PASS: dashboard, browser round creation and verified enrolment, duplicate idempotence, journal and authorization.");
 // Separate admin logout must not remove the student session.
 assert.equal((await ctx.request.get(base+"/me")).status(),200);
 await p.goto(base+"/staging");await p.locator("#dashboard").waitFor({state:"visible"});
 const own=await ctx.request.get(base+"/me/rounds");assert.equal(own.status(),200);const my=(await own.json()).data;assert(my.some(v=>v.id===round&&v.availability==="OPEN"));assert(my.every(v=>!Object.hasOwn(v,"topic")&&!Object.hasOwn(v,"topic_snapshot")));
 const roundLink=p.locator('#my-rounds a').filter({hasText:"Mở vòng / xem biên nhận"});await roundLink.waitFor();assert.equal(await roundLink.getAttribute("href"),"/exam-demo?round="+round);await roundLink.click();await p.waitForURL(base+"/exam-demo?round="+round);assert.equal(await p.locator("#round").inputValue(),round);
 await p.locator("#email").fill(email);await p.locator("#password").fill(pass);await p.locator("#login").click();await p.waitForFunction(()=>!document.querySelector("#preflight").disabled);
 await p.locator("#preflight").click();await p.waitForFunction(()=>!document.querySelector("#start").disabled);await p.locator("#start").click();await p.waitForFunction(()=>!document.querySelector("#essay").disabled);
 assert.equal(await p.locator("#topic").textContent(),qtopic);
 console.log("QUESTION SNAPSHOT PASS: selected earlier question version delivered to started attempt.");
 const guardLogin=await adminCall("login",{username:"admin",password:e.VPO_TEST_ADMIN_PASSWORD},"");assert.equal(guardLogin.status,200);
 const guard=guardLogin.data.token;
 for(const op of ["suspend","delete"])assert.equal((await adminCall("change",{id:uid,op},guard)).status,409);
 assert.equal((await adminCall("logout",{},guard)).status,200);
 assert.equal((await ctx.request.get(base+"/me")).status(),200);
 console.log("ACTIVE EXAM GUARD PASS: admin suspend/delete denied while student attempt ACTIVE.");
 async function resetCall(route,body){const r=await fetch(base+"/api/reset/"+route,{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json()};}
 const unknown=await resetCall("request",{email:"unknown-"+randomBytes(6).toString("hex")+"@example.test"});assert.equal(unknown.status,202);assert(!fs.existsSync(path.join(e.VPO_TEST_MAIL_DIR,unknown.data.challenge_id+".json")));
 const request=await resetCall("request",{email});assert.equal(request.status,202);assert(!("code" in request.data));
 const resetId=request.data.challenge_id,resetMail=JSON.parse(fs.readFileSync(path.join(e.VPO_TEST_MAIL_DIR,resetId+".json"),"utf8")),newPass=randomBytes(24).toString("hex");assert.equal(resetMail.to,email);
 const resetPayload={challenge_id:resetId,code:resetMail.code,password:newPass};
 assert.equal((await resetCall("verify",resetPayload)).status,400);assert.equal((await ctx.request.get(base+"/me")).status(),200);
 console.log("ACTIVE RECOVERY GUARD PASS: valid reset code does not interrupt active attempt.");
 await p.locator("#essay").fill("Synthetic gateway examination essay.");await p.locator("#save").click();await p.waitForFunction(()=>/xác nhận bản #1/.test(document.querySelector("#save-status").textContent));p.once("dialog",d=>d.accept());await p.locator("#submit").click();await p.waitForFunction(()=>document.querySelector("#state").textContent==="SUBMITTED");assert.match(await p.locator("#receipt-output").textContent(),/"seq": 1/);
 await p.goto(base+"/staging");await p.locator("#dashboard").waitFor({state:"visible"});
 const courseLink=p.locator("#my-courses a");await courseLink.waitFor();const coursePath=await courseLink.getAttribute("href");assert.match(coursePath,/^\/academy-demo\?course=[a-f0-9-]{36}$/);await courseLink.click();await p.waitForURL(base+coursePath);
 await p.locator("#email").fill(email);await p.locator("#password").fill(pass);await p.locator("#login").click();await p.locator("#portfolio").waitFor({state:"visible"});
 assert.equal(await p.locator("#lessons article").count(),6);assert.equal(await p.locator("#tasks article").count(),3);
 await p.locator('[data-action="complete"]').first().click();await p.getByText("Đã tự báo hoàn thành",{exact:true}).first().waitFor();await p.locator("#logout").click();await p.locator("#portfolio").waitFor({state:"hidden"});
 console.log("STUDENT DISCOVERY PASS: own enrolments, no topic disclosure, selected round and course links.");
 console.log("UNIFIED EXAM/ACADEMY PASS: enrolled synthetic student, save/receipt, course and completion through gateway.");
 await p.goto(base+"/staging");await p.locator("#login-panel").waitFor({state:"visible"});
 assert.equal((await ctx.request.get(base+"/me")).status(),401);
 async function studentLogin(password){const r=await fetch(base+"/auth/login",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({email,password})});return {status:r.status,cookie:r.headers.get("set-cookie")};}
 const before=await studentLogin(pass);assert.equal(before.status,200);const prior=before.cookie.split(";")[0];
 assert.equal((await resetCall("verify",{...resetPayload,code:resetMail.code==="00000000"?"11111111":"00000000"})).status,400);
 await p.goto(base+"/reset");await p.locator("#challenge").fill(resetId);await p.locator("#code").fill(resetMail.code);await p.locator("#newpass").fill(newPass);await postClick("#verify","/api/reset/verify",200);await p.getByText("Đã khôi phục mật khẩu mẫu.",{exact:false}).waitFor();
 assert.equal((await resetCall("verify",resetPayload)).status,400);
 assert.equal((await fetch(base+"/me",{headers:{Cookie:prior}})).status,401);assert.equal((await studentLogin(pass)).status,401);assert.equal((await studentLogin(newPass)).status,200);
 assert(!fs.existsSync(path.join(e.VPO_TEST_MAIL_DIR,resetId+".json")));
 // Explicit negative cases on synthetic accounts only.
 const unverified=await resetCall("request",{email:e.VPO_TEST_B_EMAIL});assert.equal(unverified.status,202);assert(!fs.existsSync(path.join(e.VPO_TEST_MAIL_DIR,unverified.data.challenge_id+".json")));
 assert.deepEqual(Object.keys(unknown.data).sort(),Object.keys(request.data).sort());
 const registrationMail=JSON.parse(fs.readFileSync(path.join(e.VPO_TEST_MAIL_DIR,probeResult.challenge_id+".json"),"utf8"));
 assert.equal((await resetCall("verify",{challenge_id:probeResult.challenge_id,code:registrationMail.code,password:newPass})).status,400);
 const next=await resetCall("request",{email});assert.equal(next.status,202);
 const nextId=next.data.challenge_id,nextMail=JSON.parse(fs.readFileSync(path.join(e.VPO_TEST_MAIL_DIR,nextId+".json"),"utf8"));
 const wrong=nextMail.code==="00000000"?"11111111":"00000000";
 for(let i=0;i<5;i++)assert.equal((await resetCall("verify",{challenge_id:nextId,code:wrong,password:newPass})).status,400);
 assert.equal((await resetCall("verify",{challenge_id:nextId,code:nextMail.code,password:newPass})).status,400);
 console.log("SYNTHETIC RECOVERY PASS: generic request, cross-purpose and unverified denial, five-attempt cap, wrong/replayed code denied, browser reset, old session/password rejected.");
 // Independent expiry and stale-epoch fixtures; no real accounts or clock changes.
 const edgeDb=new Client({connectionString:e.VPO_CI_OWNER_DB,statement_timeout:10000,connectionTimeoutMillis:3000});
 try{
 await edgeDb.connect();const role=(await edgeDb.query("SELECT current_database() AS db,session_user AS role")).rows[0];assert.deepEqual(role,{db:"vpo_ci",role:"vpo_migrator"});
 // Use distinct verified fixture users, so per-email request limits are not relaxed.
 async function fixture(){
  const address="recovery-edge-"+randomBytes(6).toString("hex")+"@example.test",password=randomBytes(24).toString("hex");
  const response=await fetch(base+"/api/register/request",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({email:address})});
  assert.equal(response.status,202);const id=(await response.json()).challenge_id;
  const mail=JSON.parse(fs.readFileSync(path.join(e.VPO_TEST_MAIL_DIR,id+".json"),"utf8"));
  const verified=await fetch(base+"/api/register/verify",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({challenge_id:id,code:mail.code,password})});assert.equal(verified.status,201);
  const req=await resetCall("request",{email:address});assert.equal(req.status,202);
  const cid=req.data.challenge_id,code=JSON.parse(fs.readFileSync(path.join(e.VPO_TEST_MAIL_DIR,cid+".json"),"utf8")).code;
  const owner=(await edgeDb.query("SELECT id,auth_epoch FROM vpo_stage.users WHERE email=$1",[address])).rows[0];
  return {owner,payload:{challenge_id:cid,code,password:randomBytes(24).toString("hex")}};
 }
 const expired=await fixture();
 await edgeDb.query("UPDATE vpo_stage.password_reset_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.payload.challenge_id]);
 assert.equal((await resetCall("verify",expired.payload)).status,400);
 const changed=await fixture();
 await edgeDb.query("UPDATE vpo_stage.users SET status='SUSPENDED' WHERE id=$1",[changed.owner.id]);
 await edgeDb.query("UPDATE vpo_stage.users SET status='ACTIVE' WHERE id=$1",[changed.owner.id]);
 assert.equal((await resetCall("verify",changed.payload)).status,400);
 const revoked=await fixture();
 await edgeDb.query("UPDATE vpo_stage.role_grants SET revoked_at=clock_timestamp() WHERE user_id=$1 AND role='student'",[revoked.owner.id]);
 await edgeDb.query("UPDATE vpo_stage.role_grants SET revoked_at=NULL WHERE user_id=$1 AND role='student'",[revoked.owner.id]);
 assert.equal((await resetCall("verify",revoked.payload)).status,400);
 for(const item of [expired,changed,revoked]){
  const audit=(await edgeDb.query("SELECT count(*)::int AS n FROM vpo_stage.account_admin_audit WHERE action='PASSWORD_RESET' AND user_id=$1",[item.owner.id])).rows[0];
  assert.equal(audit.n,0);
 }
 console.log("RECOVERY EDGE PASS: expired OTP, changed user epoch and changed grant epoch denied; no reset audit created.");
 }finally{await edgeDb.end();}
 assert.deepEqual(errors,[]);
 console.log("UNIFIED PORTAL PASS: ten public pages, My VPO navigation, browser OTP registration, student login, admin search/logout, separated student session, blocked unknown paths/origin.");
 }finally{await b.close();}
}
main().catch(err=>{console.error("Unified portal failed:",err.code||err.name,err.message.startsWith("No POST response")||err.message.startsWith("/api/")||err.message.startsWith("Gateway registration HTTP")?err.message:"",typeof err.actual==="number"&&typeof err.expected==="number"?("actual="+err.actual+" expected="+err.expected):"",String(err.stack||"").split("\n").find(x=>x.includes("unified-integration.cjs:"))||"");process.exitCode=1;});