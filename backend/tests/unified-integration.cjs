"use strict";
// Browser runs through gateway; internal services are never used by this browser.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{randomBytes}=require("node:crypto"),{chromium}=require("playwright");
const e=process.env,base="http://localhost:8091";
if(e.VPO_MODE!=="synthetic-staging"||e.VPO_CI_DISPOSABLE!=="yes"||!e.VPO_TEST_MAIL_DIR||!(e.GITHUB_ACTIONS==="true"||e.CODESPACES==="true"))throw Error("Disposable test only");
async function main(){
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
 await p.goto(base+"/staging");await p.locator("#dashboard").waitFor({state:"visible"});await p.locator("#logout").click();await p.locator("#dashboard").waitFor({state:"hidden"});
 assert.equal((await ctx.request.get(base+"/me")).status(),401);
 assert.deepEqual(errors,[]);
 console.log("UNIFIED PORTAL PASS: ten public pages, My VPO navigation, browser OTP registration, student login, admin search/logout, separated student session, blocked unknown paths/origin.");
 }finally{await b.close();}
}
main().catch(err=>{console.error("Unified portal failed:",err.code||err.name,err.message.startsWith("No POST response")||err.message.startsWith("/api/")||err.message.startsWith("Gateway registration HTTP")?err.message:"",typeof err.actual==="number"&&typeof err.expected==="number"?("actual="+err.actual+" expected="+err.expected):"",String(err.stack||"").split("\n").find(x=>x.includes("unified-integration.cjs:"))||"");process.exitCode=1;});