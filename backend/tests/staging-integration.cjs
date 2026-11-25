"use strict";
// Private staging launch smoke. Never target the public site.
const assert=require("node:assert/strict"),{chromium}=require("playwright");
const e=process.env,base="http://localhost:8080";
if(e.VPO_MODE!=="synthetic-staging"||e.VPO_ORIGIN!==base||!(e.GITHUB_ACTIONS==="true"||e.CODESPACES==="true"))throw Error("Local staging only");
async function main(){
 for(const route of ["/staging","/exam-demo","/academy-demo"]){const r=await fetch(base+route+"?utm_source=chatgpt.com");assert.equal(r.status,200);}
 const res=await fetch(base+"/staging?utm_source=chatgpt.com");assert.equal(res.status,200);assert.match(res.headers.get("content-security-policy"),/frame-ancestors 'none'/);assert.equal(res.headers.get("cache-control"),"no-store");
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const p=await context.newPage(),errors=[];p.on("pageerror",err=>errors.push(err.message));
  await p.goto(base+"/staging?utm_source=chatgpt.com");await p.waitForFunction(()=>!document.querySelector("#login").disabled);
  async function login(email,password){await p.locator("#email").fill(email);await p.locator("#password").fill(password);await p.locator("#login").click();await p.locator("#dashboard").waitFor({state:"visible"});assert.match(await p.locator("#profile").innerText(),/DEMO-/);return p.locator("#profile dd").first().textContent();}
  const a=await login(e.VPO_TEST_A_EMAIL,e.VPO_TEST_A_PASSWORD);
  const roundsA=await context.request.get(base+"/me/rounds");assert.equal(roundsA.status(),200);const own=(await roundsA.json()).data;assert(own.length>0);assert(own.every(v=>!("topic" in v)&&!("topic_snapshot" in v)));
  assert.equal(await p.locator("a[href='/exam-demo']").count(),1);assert.equal(await p.locator("a[href='/academy-demo']").count(),1);
  await p.waitForFunction(()=>!document.querySelector("#refresh").disabled);
  const dimensions=await p.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);assert(dimensions[0]<=dimensions[1]+2);
  await p.reload();await p.locator("#dashboard").waitFor({state:"visible"});
  assert.equal(await p.locator("#profile dd").first().textContent(),a);
  await p.locator("#logout").click();await p.locator("#dashboard").waitFor({state:"hidden"});assert.equal((await context.request.get(base+"/me")).status(),401);
  const b=await login(e.VPO_TEST_B_EMAIL,e.VPO_TEST_B_PASSWORD);assert.notEqual(a,b);
  const roundsB=await context.request.get(base+"/me/rounds");assert.equal(roundsB.status(),200);const other=(await roundsB.json()).data;assert(!other.some(v=>own.some(x=>x.id===v.id)));console.log("STUDENT ROUND ISOLATION PASS: A/B enrolments remain separate, no exam topic in discovery.");
  await p.locator("#logout").click();await p.locator("#dashboard").waitFor({state:"hidden"});
  assert.equal(errors.length,0);
  console.log("V5.7 staging dashboard: login A/B, distinct profiles, reload, logout and mobile reflow PASS");
 }finally{await browser.close();}
}
main().catch(err=>{console.error("V5.7 staging test failed:",err.name);process.exitCode=1;});