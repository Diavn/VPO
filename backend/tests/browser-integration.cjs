"use strict";
// Browser tests on local synthetic fixtures only. No public website or real data.
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require("playwright"),axe=require.resolve("axe-core/axe.min.js"),{Client}=require("pg");
const e=process.env,base="http://localhost:8080",pub="http://127.0.0.1:8090/VPO/";
if((e.GITHUB_ACTIONS!=="true"&&e.CODESPACES!=="true")||e.VPO_CI_DISPOSABLE!=="yes"||e.VPO_MODE!=="synthetic-staging"||e.VPO_ORIGIN!==base)throw Error("Disposable local browser test only");
const root=path.resolve(__dirname,"../.."),pages=["index","about","competition","results","knowledge","library","academy","community","news","support","portal"];
const mime={".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".svg":"image/svg+xml",".png":"image/png"};
const staticServer=http.createServer((req,res)=>{
 const name=req.url.split("?")[0].replace(/^\/VPO\//,"")||"index.html";
 if(!/^(?:[a-z-]+\.(?:html|css|js)|brand\/[a-z0-9_.-]+\.(?:svg|png))$/.test(name)){res.writeHead(404);return res.end();}
 const file=path.join(root,name);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.writeHead(200,{"Content-Type":mime[path.extname(file)],"Cache-Control":"no-store"});res.end(fs.readFileSync(file));
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error("Timeout: "+label);}
const txt=(p,id)=>p.locator("#"+id).textContent();
const findings=[],errors=[];
async function audit(p,label){
 // Inject axe from reviewed local npm package via Playwright evaluation, not remote script.
 await p.evaluate(fs.readFileSync(axe,"utf8"));
 const r=await p.evaluate(()=>axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}}));
 for(const v of r.violations)findings.push({page:label,id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target).slice(0,8)});
}
async function reflow(p,label){const m=await p.evaluate(()=>({actual:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));if(m.actual>m.viewport+2)errors.push(label+" overflow "+m.actual+"/"+m.viewport);}
async function load(p,url){const r=await p.goto(url,{waitUntil:"load"});assert(r&&r.ok(),url+" load failed");}
async function browserLogin(p){await p.locator("#email").fill(e.VPO_TEST_A_EMAIL);await p.locator("#password").fill(e.VPO_TEST_A_PASSWORD);await p.locator("#login").click();}
async function main(){
 let browser,owner;
 try{
 await new Promise((ok,fail)=>{staticServer.once("error",fail);staticServer.listen(8090,"127.0.0.1",ok);});
 browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true,reducedMotion:"reduce"});
 await ctx.route("**/*",r=>{const u=new URL(r.request().url());return ["127.0.0.1:8090","localhost:8080"].includes(u.host)?r.continue():r.abort();});
 const p=await ctx.newPage();p.on("pageerror",err=>errors.push("Public JS: "+err.message));p.on("response",r=>{if(r.url().startsWith(pub)&&r.status()>=400)errors.push("Public missing resource: "+new URL(r.url()).pathname);});
 for(const width of [320,390,768,1440]){
  await p.setViewportSize({width,height:900});
  for(const name of pages){for(const lang of ["vi","en"]){const label=name+"/"+lang+"/"+width;await load(p,pub+name+".html?lang="+lang);assert.equal(await p.locator("html").getAttribute("lang"),lang);assert.equal(await p.locator("main").count(),1);assert.equal(await p.locator("h1:visible").count(),1,label);await reflow(p,label);if(width===390||width===1440)await audit(p,label);}}
 }
 console.log("Public viewport/language matrix: 88 page loads; axe at 390/1440");
 await load(p,pub+"index.html");await p.keyboard.press("Tab");assert.equal(await p.evaluate(()=>document.activeElement.className),"skip");await p.keyboard.press("Enter");assert.equal(await p.evaluate(()=>location.hash),"#main");
 await p.locator("#site-search").fill("de thi");assert((await p.locator("#search-results a").count())>0);
 await p.locator("#language").click();assert.equal(await p.locator("html").getAttribute("lang"),"en");await p.locator("nav a[href='library.html']").first().click();await p.waitForURL(/library\.html\?lang=en/);assert.equal(await p.locator("html").getAttribute("lang"),"en");
 await p.locator("#archive-year").selectOption("2025");assert.equal(await p.locator("[data-archive-year]:visible").count(),1);
 await load(p,pub+"results.html");await p.locator("#year").selectOption("2025");assert((await p.locator("[data-year]:visible").count())>0);assert.equal(await p.locator("[data-year]:visible:not([data-year='2025'])").count(),0);
 await load(p,pub+"support.html");const summary=p.locator("details summary").first();await summary.focus();await p.keyboard.press("Enter");assert.equal(await p.locator("details").first().getAttribute("open"),"");
 await load(p,pub+"academy.html?lang=en");await p.locator("#essay").fill("Reasoning requires evidence.");assert.equal(await txt(p,"words"),"3 words");await p.locator("#start").click();assert(await p.locator("#start").isDisabled());const download=p.waitForEvent("download");await p.locator("#download").click();const dl=await download;assert.equal(dl.suggestedFilename(),"vpo-practice-essay.txt");p.once("dialog",d=>d.accept());await p.locator("#clear").click();assert.equal(await p.locator("#essay").inputValue(),"");
 await load(p,pub+"portal.html?lang=en");for(const k of ["profile","academic","achievements","evidence"])await p.locator("#complete-"+k).click();for(const k of ["honesty","rules","privacy"])await p.locator("#"+k).check();assert.equal(await txt(p,"profile-percent"),"100%");await p.locator("#submit-sample").click();assert.equal(await txt(p,"registration-metric"),"Under review");await p.locator("#scenario").selectOption("verified");await p.locator("#report-payment").click();assert.match(await txt(p,"payment-state"),/not reconciled/);await p.locator("#demo-reset").click();assert.equal(await txt(p,"profile-percent"),"0%");
 await ctx.close();console.log("Public keyboard, search, language, filters, FAQ, essay export and portal interactions PASS");
 owner=new Client({connectionString:e.VPO_CI_OWNER_DB,statement_timeout:10000});await owner.connect();
 const uid=(await owner.query("SELECT id FROM vpo_stage.users WHERE email=$1",[e.VPO_TEST_A_EMAIL])).rows[0].id;
 const rid=(await owner.query("INSERT INTO vpo_stage.demo_rounds(label,opens_at,closes_at,duration_seconds,topic) VALUES('DEMO browser round',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '10 minutes',180,'Synthetic browser question') RETURNING id")).rows[0].id;
 await owner.query("INSERT INTO vpo_stage.demo_enrolments(round_id,user_id) VALUES($1,$2)",[rid,uid]);
 const bx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});const ex=await bx.newPage();ex.on("pageerror",err=>errors.push("Exam JS: "+err.message));
 await load(ex,base+"/exam-demo");await reflow(ex,"exam/login/390");await audit(ex,"exam/login/390");await browserLogin(ex);await until(()=>ex.locator("#preflight").isEnabled(),"exam login");
 await ex.locator("#round").fill(rid);await ex.locator("#preflight").click();await until(()=>ex.locator("#start").isEnabled(),"preflight");await ex.locator("#start").click();await until(()=>ex.locator("#essay").isEnabled(),"exam editor");
 await ex.locator("#essay").fill("Synthetic browser essay.");await ex.locator("#save").click();await until(async()=>/xác nhận bản #1/.test(await txt(ex,"save-status")),"server save");
 await reflow(ex,"exam/editor/390");await audit(ex,"exam/editor/390");
 await ex.setViewportSize({width:1440,height:900});await reflow(ex,"exam/editor/1440");
 ex.once("dialog",d=>d.accept());await ex.locator("#submit").click();await until(async()=>await txt(ex,"state")==="SUBMITTED","submitted");assert(await ex.locator("#essay").isDisabled());assert.match(await txt(ex,"receipt-output"),/"seq": 1/);await bx.close();
 console.log("Exam browser login, preflight, save, submit and receipt PASS");
 const ac=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});const ap=await ac.newPage();ap.on("pageerror",err=>errors.push("Academy JS: "+err.message));
 await load(ap,base+"/academy-demo");await reflow(ap,"academy/login/390");await audit(ap,"academy/login/390");await browserLogin(ap);await until(()=>ap.locator("#portfolio").isVisible(),"academy portfolio");assert.equal(await ap.locator("#lessons article").count(),6);assert.equal(await ap.locator("#tasks article").count(),3);await reflow(ap,"academy/portfolio/390");await audit(ap,"academy/portfolio/390");
 await ap.locator("#refresh").click();await until(()=>ap.locator("#refresh").isEnabled(),"academy refresh");await ap.setViewportSize({width:1440,height:900});await reflow(ap,"academy/portfolio/1440");await ap.locator("#logout").click();await until(()=>ap.locator("#portfolio").isHidden(),"academy logout");await ac.close();
 console.log("Academy browser login, portfolio, feedback, refresh and logout PASS");
 }finally{
 if(browser)await browser.close();if(owner)await owner.end();staticServer.close();
 // No user data, screenshots, passwords, cookies, or raw essay text in audit logs.
 console.log("Browser reflow/JS findings:",JSON.stringify(errors));
 console.log("Axe findings:",JSON.stringify(findings));
 }
 assert.equal(errors.length,0,"Browser layout/JS failures");
 assert.equal(findings.filter(x=>["critical","serious"].includes(x.impact)).length,0,"Serious/critical automated accessibility findings");
 console.log("V5.4 browser smoke PASS; manual accessibility and other engines remain untested.");
}
main().catch(e=>{console.error("V5.4 browser smoke failed:",e.message);process.exitCode=1;});