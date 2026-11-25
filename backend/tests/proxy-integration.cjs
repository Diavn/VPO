"use strict";
// Actual HTTP integration of a simulated Codespaces header rewrite. No external network.
const assert=require("node:assert/strict"),http=require("node:http"),{spawn}=require("node:child_process"),{randomBytes}=require("node:crypto");
const e=process.env;
if(e.VPO_MODE!=="synthetic-staging"||e.VPO_CI_DISPOSABLE!=="yes"||e.VPO_ORIGIN!=="http://localhost:8080"||!(e.GITHUB_ACTIONS==="true"||e.CODESPACES==="true"))throw Error("Disposable local fixture only");
const domain="app.github.dev",space="regression-proxy",external=p=>"https://"+space+"-"+p+"."+domain;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function call(port,path,method="GET",body,headers={}){
 return new Promise((resolve,reject)=>{
  const data=body===undefined?undefined:JSON.stringify(body);
  const q=http.request({hostname:"127.0.0.1",port,path,method,headers:{Host:"localhost:"+port,...(data===undefined?{}:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)}),...headers}},r=>{
   let text="";r.setEncoding("utf8");r.on("data",x=>text+=x);r.on("end",()=>{let data;try{data=JSON.parse(text);}catch{data=null;}resolve({status:r.statusCode,headers:r.headers,data});});r.on("error",reject);
  });q.setTimeout(15000,()=>q.destroy(Error("HTTP timeout")));q.on("error",reject);q.end(data);
 });
}
const meta={"Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"cors","Sec-Fetch-Dest":"empty"};
function start(file,port,extra){return spawn(process.execPath,[file],{cwd:require("node:path").join(__dirname,".."),env:{PATH:e.PATH,VPO_MODE:"synthetic-staging",GITHUB_ACTIONS:e.GITHUB_ACTIONS||"",CODESPACES:"true",CODESPACE_NAME:space,GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:domain,VPO_CODESPACES_PROXY:"yes",VPO_PORT:String(port),VPO_ORIGIN:external(port),VPO_CSRF_KEY:randomBytes(32).toString("hex"),...extra},stdio:"ignore"});}
async function ready(child,port){for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error("Proxy fixture process exited");try{if((await call(port,"/healthz")).status===200)return;}catch{}await sleep(250);}throw Error("Proxy fixture readiness timeout");}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;await new Promise(resolve=>{let timer=setTimeout(()=>child.kill("SIGKILL"),6000);child.once("exit",()=>{clearTimeout(timer);resolve();});child.kill("SIGTERM");});}
async function main(){
 let a,s,g;
 try{
 a=start("account-client/server.cjs",8082,{DATABASE_URL:e.VPO_TEST_ACCOUNTS_DB,VPO_ADMIN_HASH:e.VPO_TEST_ADMIN_HASH,VPO_MAIL_KEY:e.VPO_TEST_MAIL_KEY,VPO_MAIL_DIR:e.VPO_TEST_MAIL_DIR});
 s=start("server.cjs",8080,{DATABASE_URL:e.DATABASE_URL});
 await ready(a,8082);await ready(s,8080);
 g=start("gateway/server.cjs",8091,{});await ready(g,8091);
 assert.equal((await call(8082,"/admin?utm_source=chatgpt.com")).status,200);
 const credentials={username:"admin",password:e.VPO_TEST_ADMIN_PASSWORD};
 for(const h of [{Origin:"null",...meta},{Origin:"http://localhost:8082","Sec-Fetch-Site":"cross-site","Sec-Fetch-Mode":"cors","Sec-Fetch-Dest":"empty"},{Origin:"http://localhost:8080",...meta},{Origin:"http://localhost:8082"},{...meta}])assert.equal((await call(8082,"/api/admin/login","POST",credentials,h)).status,403);
 const admin=await call(8082,"/api/admin/login","POST",credentials,{Origin:"http://localhost:8082",...meta});assert.equal(admin.status,200);
 const auth={Origin:"http://127.0.0.1:8082",...meta,Authorization:"Bearer "+admin.data.token};
 assert.equal((await call(8082,"/api/admin/users","POST",{search:e.VPO_TEST_A_EMAIL},auth)).status,200);
 assert.equal((await call(8082,"/api/admin/logout","POST",{},auth)).status,200);
 assert.equal((await call(8082,"/api/admin/users","POST",{search:""},auth)).status,401);
 const exact=await call(8082,"/api/admin/login","POST",credentials,{Host:external(8082).slice(8),Origin:external(8082)});assert.equal(exact.status,200);
 assert.equal((await call(8082,"/api/admin/logout","POST",{},{Origin:external(8082),Authorization:"Bearer "+exact.data.token})).status,200);
 // B has at most 7 prior logins in this fixture. Do not reset rate limits to make tests pass.
 const st=await call(8080,"/auth/login","POST",{email:e.VPO_TEST_B_EMAIL,password:e.VPO_TEST_B_PASSWORD},{Origin:"http://localhost:8080",...meta});
 assert.equal(st.status,200);const cookie=st.headers["set-cookie"][0];assert.match(cookie,/^__Host-vpo_session=/);assert.match(cookie,/; Secure/);
 const student={Cookie:cookie.split(";")[0],"X-CSRF-Token":st.data.csrf,Origin:"http://127.0.0.1:8080",...meta};
 assert.equal((await call(8080,"/me","GET",undefined,student)).status,200);
 assert.equal((await call(8080,"/auth/logout","POST",undefined,{...student,Origin:"http://localhost:8082"})).status,403);
 // Carry the same secure session through the unified origin. Do not spend another login.
 const gatewayStudent={...student,Origin:"http://127.0.0.1:8091"};
 assert.equal((await call(8091,"/me","GET",undefined,gatewayStudent)).status,200);
 assert.equal((await call(8091,"/auth/logout","POST",undefined,{...gatewayStudent,Origin:"http://localhost:8080"})).status,403);
 assert.equal((await call(8091,"/auth/logout","POST",undefined,{...gatewayStudent,"X-CSRF-Token":"0".repeat(64)})).status,403);
 const gone=await call(8091,"/auth/logout","POST",undefined,gatewayStudent);assert.equal(gone.status,200);assert.match(gone.headers["set-cookie"][0],/Max-Age=0/);
 assert.equal((await call(8080,"/me","GET",undefined,student)).status,401);
 console.log("UNIFIED SECURE STUDENT PASS: cookie forwarding, wrong Origin/CSRF denied, logout clears session.");
 const through=await call(8091,"/api/admin/login","POST",credentials,{Origin:"http://localhost:8091",...meta});assert.equal(through.status,200);
 const throughAuth={Origin:"http://127.0.0.1:8091",...meta,Authorization:"Bearer "+through.data.token};
 assert.equal((await call(8091,"/api/admin/users","POST",{search:e.VPO_TEST_A_EMAIL},throughAuth)).status,200);
 assert.equal((await call(8091,"/api/admin/users","POST",{search:""},{...throughAuth,Origin:"http://localhost:8082"})).status,403);
 assert.equal((await call(8091,"/api/admin/logout","POST",{},throughAuth)).status,200);
 assert.equal((await call(8091,"/api/admin/users","POST",{search:""},throughAuth)).status,401);
 console.log("UNIFIED PROXY PASS: simulated private HTTPS gateway, rewritten same-port Origin, admin login/list/logout, wrong origin denied.");
 console.log("PROXY HTTP PASS: simulated exact and rewritten Host/Origin, Admin login/list/logout, student secure session and cross-origin rejection. Real Codespaces proxy NOT tested.");
 }finally{await Promise.all([stop(g),stop(a),stop(s)]);}
}
main().catch(err=>{console.error("Proxy HTTP failed:",err.code||err.name,typeof err.actual==="number"&&typeof err.expected==="number"?("actual="+err.actual+" expected="+err.expected):"",String(err.stack||"").split("\n").find(x=>x.includes("proxy-integration.cjs:"))||"");process.exitCode=1;});
