"use strict";
// Synthetic localhost test, never a public target.
const assert=require("node:assert/strict"),{Client}=require("pg"),{randomUUID,randomBytes}=require("node:crypto"),S=require("../security.cjs");
const e=process.env,base="http://localhost:8080";
if((e.GITHUB_ACTIONS!=="true"&&e.CODESPACES!=="true")||e.VPO_CI_DISPOSABLE!=="yes"||e.VPO_MODE!=="synthetic-staging"||e.VPO_ORIGIN!==base)throw Error("Disposable local test only");
async function call(path,method="GET",s=null,b,opts={}){
 const headers={};if(method!=="GET")headers.Origin=base;if(s){headers.Cookie=s.cookie;headers["X-CSRF-Token"]=s.csrf;}if(b!==undefined)headers["Content-Type"]="application/json";
 Object.assign(headers,opts.headers||{});
 const r=await fetch(base+path,{method,headers,body:b===undefined?undefined:opts.raw?b:JSON.stringify(b),signal:AbortSignal.timeout(15000),redirect:"error"});return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie"),headers:r.headers};
}
async function main(){
 const owner=new Client({connectionString:e.VPO_CI_OWNER_DB,statement_timeout:10000}),rt=new Client({connectionString:e.DATABASE_URL,statement_timeout:10000});
 try{
 await owner.connect();await rt.connect();
 const email="security-"+randomUUID()+"@example.test",password=randomBytes(24).toString("hex"),hash=await S.hashPassword(password);
 const id=(await owner.query("INSERT INTO vpo_stage.users(email,password_hash,status) VALUES($1,$2,'ACTIVE') RETURNING id",[email,hash])).rows[0].id;
 await owner.query("INSERT INTO vpo_stage.role_grants(user_id,role) VALUES($1,'student')",[id]);
 await owner.query("INSERT INTO vpo_stage.student_profiles(user_id,student_code,name_vi,name_latin,grade,curriculum,locale) VALUES($1,$2,'DEMO','DEMO','11','DEMO-VN','vi')",[id,"DEMO-"+randomUUID()]);
 const login=async()=>{const r=await call("/auth/login","POST",null,{email,password});assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);assert.equal(r.headers.get("cache-control"),"no-store");return {cookie:r.cookie.split(";")[0],csrf:r.data.csrf};};
 const a=await login();assert.equal((await call("/me","GET",a)).status,200);
 const patch={grade:"11",curriculum:"DEMO-VN",locale:"vi",version:1};
 assert.equal((await call("/me/profile","PATCH",a,patch,{headers:{Origin:"http://untrusted.example.test"}})).status,403);
 assert.equal((await call("/me/profile","PATCH",{...a,csrf:"0".repeat(64)},patch)).status,403);
 assert.equal((await call("/me/profile","PATCH",a,{...patch,user_id:id})).status,422);
 assert.equal((await call("/me/profile","PATCH",a,"{",{raw:true})).status,400);
 assert.equal((await call("/me/profile","PATCH",a,Buffer.from([0x7b,0xff,0x7d]),{raw:true})).status,400);
 assert.equal((await call("/me/profile","PATCH",a,patch,{headers:{"Content-Encoding":"gzip"}})).status,415);
 assert.equal((await call("/me/profile","PATCH",a,patch,{headers:{"Content-Type":"text/plain"}})).status,415);
 assert.equal((await call("/me/profile","PATCH",a,{...patch,padding:"x".repeat(9000)})).status,413);
 const h=await call("/healthz");assert.equal(h.status,200);assert.equal(h.headers.get("x-frame-options"),"DENY");assert.equal(h.headers.get("x-content-type-options"),"nosniff");assert.match(h.headers.get("content-security-policy"),/default-src 'none'/);
 for(const path of ["/exam-demo","/academy-demo"]){const r=await fetch(base+path);assert.equal(r.status,200);assert.equal(r.headers.get("cross-origin-resource-policy"),"same-origin");assert.match(r.headers.get("permissions-policy"),/camera=\(\)/);assert.match(r.headers.get("content-security-policy"),/frame-ancestors 'none'/);await r.text();}
 console.log("SEC01-03 request validation, CSRF/origin and response headers PASS");
 const epochs=(await owner.query("SELECT u.auth_epoch AS ue,g.auth_epoch AS ge FROM vpo_stage.users u JOIN vpo_stage.role_grants g ON g.user_id=u.id WHERE u.id=$1",[id])).rows[0];
 await owner.query("UPDATE vpo_stage.role_grants SET revoked_at=clock_timestamp() WHERE user_id=$1",[id]);
 assert.equal((await call("/me","GET",a)).status,401);
 await owner.query("UPDATE vpo_stage.role_grants SET revoked_at=NULL WHERE user_id=$1",[id]);
 assert.equal((await call("/me","GET",a)).status,401);
 const stale=(await rt.query("SELECT vpo_stage.issue_student_session($1,$2,$3,$4) AS ok",[id,S.digest(randomBytes(32).toString("hex")),epochs.ue,epochs.ge])).rows[0];assert.equal(stale.ok,false);
 const b=await login();assert.equal((await call("/me","GET",b)).status,200);
 await owner.query("UPDATE vpo_stage.users SET status='SUSPENDED' WHERE id=$1",[id]);await owner.query("UPDATE vpo_stage.users SET status='ACTIVE' WHERE id=$1",[id]);
 assert.equal((await call("/me","GET",b)).status,401);
 const c=await login();assert.equal((await call("/me","GET",c)).status,200);
 await owner.query("UPDATE vpo_stage.users SET password_hash=$2 WHERE id=$1",[id,await S.hashPassword(password)]);
 assert.equal((await call("/me","GET",c)).status,401);
 await assert.rejects(()=>rt.query("INSERT INTO vpo_stage.sessions(token_hash,user_id,expires_at,idle_until) VALUES($1,$2,now()+interval '1 hour',now()+interval '1 hour')",[S.digest(randomBytes(32).toString("hex")),id]),x=>x.code==="42501");
 await assert.rejects(()=>owner.query("DELETE FROM vpo_stage.role_grants WHERE user_id=$1",[id]),x=>x.code==="23514");
 const d=await login();assert.equal((await call("/auth/logout","POST",d)).status,200);assert.equal((await call("/me","GET",d)).status,401);
 console.log("SEC04-08 permanent session invalidation, stale issuance, direct grant denial and logout PASS");
 }finally{await owner.end().catch(()=>{});await rt.end().catch(()=>{});}
}
main().catch(x=>{console.error("Security smoke failed:",x.code||x.name);process.exitCode=1;});