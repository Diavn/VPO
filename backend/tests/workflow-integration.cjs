"use strict";
const assert=require("node:assert/strict"),{Client}=require("pg");
const e=process.env,base=e.VPO_ORIGIN,cid=e.VPO_CI_CASE,oid=e.VPO_CI_ORDER;
if((e.GITHUB_ACTIONS!=="true"&&e.CODESPACES!=="true")||e.VPO_CI_DISPOSABLE!=="yes"||e.VPO_MODE!=="synthetic-staging"||base!=="http://localhost:8080")throw Error("CI disposable fixture required");
const roles=["ci_exam_a","ci_exam_b","ci_moderator","ci_approver","ci_publisher","ci_finance","ci_appeal","ci_cert","ci_cert_approver"];
const db={};
const {spawn}=require("node:child_process"),{randomBytes}=require("node:crypto"),{chromium}=require("playwright");
let desk,deskKey,browser;const deskBase="http://localhost:8081";
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
  // Use existing authenticated synthetic sessions in the browser; avoid extra login rate consumption.
  browser=await chromium.launch({headless:true});
  const gateway="http://localhost:8091";
  async function studentPage(session){
   const ctx=await browser.newContext({viewport:{width:390,height:844}});
   await ctx.route("**/*",r=>new URL(r.request().url()).origin===gateway?r.continue():r.abort());
   const sep=session.cookie.indexOf("=");await ctx.addCookies([{name:session.cookie.slice(0,sep),value:session.cookie.slice(sep+1),url:gateway,httpOnly:true}]);
   const page=await ctx.newPage();await page.goto(gateway+"/staging");await page.locator("#dashboard").waitFor({state:"visible"});return page;
  }
  const p=await studentPage(a),other=await studentPage(b),errors=[];p.on("pageerror",err=>errors.push(err.name));
  assert.match(await p.locator("#results").innerText(),/15(?:\.0)?\/20/);
  assert.match(await p.locator("#results").innerText(),/Giải Nhất/);
  assert.match(await other.locator("#results").innerText(),/Chưa có kết quả/);
  assert.equal(await other.locator("#orders button").count(),0);
  const report="/me/orders/"+oid+"/report";
  assert.equal((await call(report,"POST",b,{transfer_ref:e.VPO_CI_TRANSFER})).status,404);
  assert.equal((await call(report,"POST",a,{transfer_ref:e.VPO_CI_TRANSFER,state:"PAID"})).status,422);
  await assert.rejects(()=>staff("ci_finance","reconcile",oid));
  await p.locator("#ref-"+oid).fill(e.VPO_CI_TRANSFER);
  p.once("dialog",d=>d.accept());
  const [reported]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname===report&&r.request().method()==="POST"),p.getByRole("button",{name:"Báo giao dịch mẫu",exact:true}).click()]);
  assert.equal(reported.status(),201);await p.getByText("Chờ đối soát",{exact:true}).waitFor();
  assert.equal((await call("/me/orders","GET",a)).data.data[0].state,"REPORTED");
  await staff("ci_finance","reconcile",oid);await assert.rejects(()=>staff("ci_finance","reconcile",oid));
  assert.equal((await call("/me/orders","GET",a)).data.data[0].state,"PAID");
  await p.locator("#refresh").click();await p.getByText("Đã đối soát",{exact:true}).waitFor();assert.equal(await p.locator("#orders button").count(),0);
  const c=await staff("ci_cert","cert_issue",cid);assert.equal(c.verification_token.length,64);
  const url=c.verification_path;assert.equal((await call(url)).data.status,"VALID_DEMO");
  const verifyContext=await browser.newContext({viewport:{width:390,height:844}});await verifyContext.route("**/*",r=>new URL(r.request().url()).origin===gateway?r.continue():r.abort());
  const v=await verifyContext.newPage();await v.goto(gateway+"/verify-demo");
  async function checkCertificate(code,expected){
   await v.locator("#token").fill(code);await v.locator("#verify").click();await v.getByText(expected,{exact:true}).waitFor();await v.waitForFunction(()=>!document.querySelector("#verify").disabled);assert.equal(await v.locator("#token").inputValue(),"");
   assert.equal(await v.locator("#verification-data").getByText("Giải mẫu",{exact:true}).count(),expected==="Hợp lệ trong mô phỏng"?1:0);
  }
  // A scanned QR fragment is removed from location before verification; no auto request.
  await v.goto(gateway+"/verify-demo#"+c.verification_token);await v.waitForFunction(()=>!location.hash);assert.equal(await v.locator("#token").inputValue(),c.verification_token);
  await checkCertificate(c.verification_token,"Hợp lệ trong mô phỏng");
  const documentPath=url+"/document.pdf";
  const pdfResponse=await verifyContext.request.get(gateway+documentPath);assert.equal(pdfResponse.status(),200);assert.equal(pdfResponse.headers()["content-type"],"application/pdf");assert.equal(pdfResponse.headers()["cache-control"],"no-store");assert.match(pdfResponse.headers()["content-disposition"],/attachment/);
  const {PDFDocument}=require("pdf-lib");assert.equal((await PDFDocument.load(await pdfResponse.body())).getPageCount(),1);
  const [download]=await Promise.all([v.waitForEvent("download"),v.locator("#slip").click()]);assert.equal(download.suggestedFilename(),"VPO-DEMO-verification.pdf");assert.equal((await PDFDocument.load(require("node:fs").readFileSync(await download.path()))).getPageCount(),1);await download.delete();
  assert.equal((await verifyContext.request.get(gateway+"/public/certificates/"+"0".repeat(64)+"/document.pdf")).status(),404);
  assert.equal((await call("/public/certificates/"+"0".repeat(64))).status,404);
  const appeal="/me/results/"+cid+"/appeal";assert.equal((await call(appeal,"POST",b,{category:"SCORING"})).status,404);
  await p.locator("#appeal-"+cid).selectOption("SCORING");p.once("dialog",d=>d.accept());
  const [appealed]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname===appeal&&r.request().method()==="POST"),p.getByRole("button",{name:"Gửi phúc khảo mẫu",exact:true}).click()]);
  assert.equal(appealed.status(),201);await p.getByText("Phúc khảo: Đang xem xét",{exact:true}).waitFor();assert.equal((await call(url)).data.status,"ON_HOLD");await checkCertificate(c.verification_token,"Đang tạm giữ");assert.equal(await v.locator("#slip").isVisible(),false);assert.equal(await v.locator("#slip").getAttribute("href"),null);assert.equal((await verifyContext.request.get(gateway+documentPath)).status(),409);
  await staff("ci_appeal","appeal_decide",cid,{decision:"DISMISSED",reason:"Synthetic review"});assert.equal((await call(url)).data.status,"VALID_DEMO");
  await p.locator("#refresh").click();await p.getByText("Phúc khảo: Không chấp nhận",{exact:true}).waitFor();await checkCertificate(c.verification_token,"Hợp lệ trong mô phỏng");
  await staff("ci_cert","cert_revoke_request",c.certificate_id,{reason:"Synthetic revocation"});
  await assert.rejects(()=>staff("ci_cert","cert_revoke_approve",c.certificate_id));assert.equal((await call(url)).data.status,"ON_HOLD");
  await staff("ci_cert_approver","cert_revoke_approve",c.certificate_id);assert.equal((await call(url)).data.status,"REVOKED");
  await checkCertificate(c.verification_token,"Đã thu hồi");assert.equal(await v.locator("#slip").isVisible(),false);assert.equal((await verifyContext.request.get(gateway+documentPath)).status(),409);console.log("DEMO CERTIFICATE PDF PASS: QR fragment entry, browser PDF download, valid parse, no-store, held/revoked/unknown denied.");await checkCertificate("0".repeat(64),"Không tìm thấy chứng nhận mẫu.");assert.equal(await v.locator("#verification").isVisible(),false);
  assert.equal(errors.length,0);
  console.log("FINANCE RESULTS UI PASS: gateway browser payment report, independent reconciliation, published result isolation, appeal and anonymous certificate status lifecycle.");
  await call("/auth/logout","POST",a);await call("/auth/logout","POST",b);
  console.log("V6 staff desk PASS: browser queue/read, wrong token/origin/role denied, cross-assignment denied, actual mark lock and duplicate refusal via HTTP.");
  console.log("Workflow synthetic smoke passed.");
 }finally{if(browser)await browser.close();if(desk){desk.kill("SIGTERM");await new Promise(r=>{if(desk.exitCode!==null)r();else desk.once("exit",r);});}await Promise.all(Object.values(db).map(x=>x.end().catch(()=>{})));}
}
main().catch(e=>{console.error("Workflow smoke failed:",e.code||e.name);process.exitCode=1;});