"use strict";
const http=require("node:http");
const {Pool}=require("pg");
const S=require("./security.cjs");
const E=require("./exam.cjs"),P=require("./exam-policy.cjs"),W=require("./workflow-policy.cjs"),A=require("./academy-policy.cjs");
const fs=require("node:fs"),pathLib=require("node:path");
const demoAssets=Object.fromEntries([["/exam-demo","exam.html","text/html; charset=utf-8"],["/exam-demo.js","exam.js","text/javascript; charset=utf-8"],["/exam-demo.css","exam.css","text/css; charset=utf-8"]].map(([url,file,type])=>[url,{type,body:fs.readFileSync(pathLib.join(__dirname,"exam-client",file))}]));
for(const [url,file,type] of [["/academy-demo","academy.html","text/html; charset=utf-8"],["/academy-demo.js","academy.js","text/javascript; charset=utf-8"],["/academy-demo.css","academy.css","text/css; charset=utf-8"]])demoAssets[url]={type,body:fs.readFileSync(pathLib.join(__dirname,"academy-client",file))};
const c=S.config(process.env);
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,statement_timeout:5000,query_timeout:6000});
pool.on("error",()=>console.error("Database pool error"));
const q=(sql,p=[])=>pool.query(sql,p);
const fail=(status,code)=>Object.assign(Error(code),{status,code});
function cookie(token,clear=false){return c.cookie+"="+(clear?"":token)+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+(clear?"0":"28800")+(c.secure?"; Secure":"");}
function reply(res,status,value,extra={}){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'; base-uri 'none'","Permissions-Policy":"camera=(), microphone=(), geolocation=()",...(c.secure?{"Strict-Transport-Security":"max-age=31536000"}:{}),...extra});res.end(JSON.stringify(value));}
async function body(req,maxBytes=8192){if(req.headers["content-type"]?.split(";")[0].trim().toLowerCase()!=="application/json")throw fail(415,"JSON_REQUIRED");const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>maxBytes)throw fail(413,"BODY_TOO_LARGE");chunks.push(part);}try{const b=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!b||typeof b!=="object"||Array.isArray(b))throw Error();return b;}catch{throw fail(400,"INVALID_JSON");}}
async function tx(fn){const db=await pool.connect();try{await db.query("BEGIN");const v=await fn(db);await db.query("COMMIT");return v;}catch(e){await db.query("ROLLBACK").catch(()=>{});throw e;}finally{db.release();}}
async function limit(bucket,max){const r=await q("INSERT INTO vpo_stage.login_limits(bucket,window_start,hits) VALUES($1,date_bin('15 minutes',now(),TIMESTAMPTZ '2000-01-01'),1) ON CONFLICT(bucket,window_start) DO UPDATE SET hits=LEAST(vpo_stage.login_limits.hits+1,10000) RETURNING hits",[bucket]);if(r.rows[0].hits>max)throw fail(429,"TRY_LATER");}
async function auth(req){const token=S.readToken(req.headers.cookie,c.cookie);if(!token)throw fail(401,"UNAUTHENTICATED");const hash=S.digest(token);
 const r=await q("UPDATE vpo_stage.sessions s SET idle_until=LEAST(s.expires_at,now()+interval '30 minutes') FROM vpo_stage.users u WHERE s.token_hash=$1 AND s.user_id=u.id AND u.status='ACTIVE' AND s.expires_at>now() AND s.idle_until>now() AND EXISTS(SELECT 1 FROM vpo_stage.role_grants g WHERE g.user_id=u.id AND g.role='student' AND g.revoked_at IS NULL) RETURNING s.user_id",[hash]);
 if(r.rowCount!==1)throw fail(401,"UNAUTHENTICATED");return {id:r.rows[0].user_id,hash,token};}
function requireCsrf(req,a){if(!S.eq(req.headers["x-csrf-token"],S.csrf(a.token,c.key)))throw fail(403,"CSRF_REQUIRED");}
const projection="student_code,name_vi,name_latin,grade,curriculum,locale,version";
let dummy, activeHashes=0;
async function handle(req,res){
 if(req.headers.host!==c.host)throw fail(400,"INVALID_HOST");
 if(!["GET","POST","PATCH","PUT"].includes(req.method))throw fail(405,"METHOD_NOT_ALLOWED");
 if(req.method!=="GET"&&req.headers.origin!==c.origin)throw fail(403,"ORIGIN_REQUIRED");
 const path=req.url;
 if(req.method==="GET"&&Object.hasOwn(demoAssets,path)){const a=demoAssets[path];res.writeHead(200,{"Content-Type":a.type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});return res.end(a.body);}
 if(path==="/healthz"&&req.method==="GET"){await q("SELECT 1");return reply(res,200,{status:"ok",mode:"synthetic-staging"});}
 if(path==="/auth/login"&&req.method==="POST"){
  await limit("global",120);const b=await body(req);
  if(Object.keys(b).sort().join(",")!=="email,password"||!S.validEmail(b.email)||!S.validPassword(b.password))throw fail(400,"SYNTHETIC_CREDENTIALS_REQUIRED");
  await limit("account:"+S.accountBucket(b.email,c.key),8);
  if(activeHashes>=2)throw fail(503,"TRY_LATER");activeHashes++;
  let user,ok;try{const r=await q("SELECT u.id,u.password_hash FROM vpo_stage.users u WHERE u.email=$1 AND u.status='ACTIVE' AND EXISTS(SELECT 1 FROM vpo_stage.role_grants g WHERE g.user_id=u.id AND g.role='student' AND g.revoked_at IS NULL)",[b.email]);user=r.rows[0];ok=await S.verifyPassword(b.password,user?.password_hash||dummy);}finally{activeHashes--;}
  if(!user||!ok)throw fail(401,"INVALID_CREDENTIALS");
  const token=S.hex(32);const prior=S.readToken(req.headers.cookie,c.cookie);
  await tx(async db=>{if(prior)await db.query("DELETE FROM vpo_stage.sessions WHERE token_hash=$1 AND user_id=$2",[S.digest(prior),user.id]);await db.query("INSERT INTO vpo_stage.sessions(token_hash,user_id,expires_at,idle_until) VALUES($1,$2,now()+interval '8 hours',now()+interval '30 minutes')",[S.digest(token),user.id]);await db.query("INSERT INTO vpo_stage.audit_events(user_id,event) VALUES($1,'LOGIN_OK')",[user.id]);});
  return reply(res,200,{role:"student",csrf:S.csrf(token,c.key),mode:"synthetic-staging"},{"Set-Cookie":cookie(token)});
 }
 if(path==="/me"&&req.method==="GET"){
  const a=await auth(req);const r=await q("SELECT "+projection+" FROM vpo_stage.student_profiles WHERE user_id=$1",[a.id]);if(!r.rowCount)throw fail(404,"PROFILE_NOT_FOUND");
  return reply(res,200,{role:"student",profile:r.rows[0],csrf:S.csrf(a.token,c.key),mode:"synthetic-staging"});
 }
 if(path==="/me/profile"&&req.method==="PATCH"){
  const a=await auth(req);requireCsrf(req,a);const b=S.profilePatch(await body(req));if(!b)throw fail(422,"INVALID_PROFILE");
  const profile=await tx(async db=>{const r=await db.query("UPDATE vpo_stage.student_profiles SET grade=$1,curriculum=$2,locale=$3,version=version+1 WHERE user_id=$4 AND version=$5 AND EXISTS(SELECT 1 FROM vpo_stage.role_grants g JOIN vpo_stage.users u ON u.id=g.user_id WHERE g.user_id=$4 AND g.role='student' AND g.revoked_at IS NULL AND u.status='ACTIVE') RETURNING "+projection,[b.grade,b.curriculum,b.locale,a.id,b.version]);if(!r.rowCount)throw fail(409,"STALE_OR_UNAVAILABLE");await db.query("INSERT INTO vpo_stage.audit_events(user_id,event) VALUES($1,'PROFILE_UPDATE')",[a.id]);return r.rows[0];});return reply(res,200,{profile});
 }
 if(path==="/auth/logout"&&req.method==="POST"){const a=await auth(req);requireCsrf(req,a);await tx(async db=>{await db.query("DELETE FROM vpo_stage.sessions WHERE token_hash=$1 AND user_id=$2",[a.hash,a.id]);await db.query("INSERT INTO vpo_stage.audit_events(user_id,event) VALUES($1,'LOGOUT')",[a.id]);});return reply(res,200,{ok:true},{"Set-Cookie":cookie("",true)});}

 const rm=/^\/rounds\/([^/]+)\/(preflight|attempts)$/.exec(path);
 const am=/^\/attempts\/([^/]+)(?:\/(topics|draft|submit|receipt|events))?$/.exec(path);
 if(rm||am){
  const id=(rm||am)[1];if(!P.uuid(id))throw fail(404,"NOT_FOUND");
  const a=await auth(req);if(req.method!=="GET")requireCsrf(req,a);
  let operation,b=null;
  if(rm){if(rm[2]==="preflight"&&req.method==="GET")operation="preflight";else if(rm[2]==="attempts"&&req.method==="POST")operation="start";}
  else{
   const sub=am[2]||"status";
   if(req.method==="GET"&&["status","topics","draft","receipt"].includes(sub))operation=sub==="draft"?"draft-get":sub;
   if(req.method==="PUT"&&sub==="draft"){operation="draft-put";b=await body(req,65536);if(!P.validDraft(b))throw fail(422,"INVALID_DRAFT");}
   if(req.method==="POST"&&sub==="submit"){operation="submit";b=await body(req);if(!P.validSubmit(b))throw fail(422,"INVALID_SUBMIT");}
   if(req.method==="POST"&&sub==="events"){operation="event";b=await body(req);if(!P.validEvent(b))throw fail(422,"INVALID_EVENT");}
  }
  if(!operation)throw fail(405,"METHOD_NOT_ALLOWED");
  if(req.method!=="GET")await limit("exam:"+a.id,600);
  const out=await tx(async db=>{
   const live=await db.query("SELECT 1 FROM vpo_stage.sessions s JOIN vpo_stage.users u ON u.id=s.user_id JOIN vpo_stage.role_grants g ON g.user_id=u.id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND s.idle_until>clock_timestamp() AND u.status='ACTIVE' AND g.role='student' AND g.revoked_at IS NULL",[a.hash,a.id]);
   if(!live.rowCount)throw fail(401,"UNAUTHENTICATED");
   if(operation==="preflight")return E.preflight(db,id,a.id);
   if(operation==="start")return E.start(db,id,a.id);
   return E.attempt(db,id,a.id,operation,b);
  });
  return reply(res,out.status,out.value);
 }

 // V4.6 local synthetic student workflow; no staff HTTP routes.
 const cv=/^\/public\/certificates\/([^/]+)$/.exec(path);
 if(cv&&req.method==="GET"){
  await limit("demo-certificate-global",300);
  if(!W.validToken(cv[1]))throw fail(404,"NOT_FOUND");
  const r=await q("SELECT vpo_stage.demo_verify_certificate($1) AS value",[cv[1]]);
  if(!r.rows[0].value)throw fail(404,"NOT_FOUND");
  return reply(res,200,r.rows[0].value);
 }
 const ow=/^\/me\/orders\/([^/]+)\/report$/.exec(path),aw=/^\/me\/results\/([^/]+)\/appeal$/.exec(path);
 const list=path==="/me/orders"?"orders":path==="/me/results"?"results":null;
 if((list&&req.method==="GET")||((ow||aw)&&req.method==="POST")){
  const a=await auth(req);let op=list,obj=null,b={};
  if(ow||aw){
   requireCsrf(req,a);obj=(ow||aw)[1];if(!P.uuid(obj))throw fail(404,"NOT_FOUND");
   b=await body(req);op=ow?"report":"appeal";
   if(!(ow?W.validateReport(b):W.validateAppeal(b)))throw fail(422,"INVALID_INPUT");
   await limit("workflow:"+a.id,30);
  }
  try{
   const value=await tx(async db=>{
    const live=await db.query("SELECT 1 FROM vpo_stage.sessions s JOIN vpo_stage.users u ON u.id=s.user_id JOIN vpo_stage.role_grants g ON g.user_id=u.id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND s.idle_until>clock_timestamp() AND u.status='ACTIVE' AND g.role='student' AND g.revoked_at IS NULL",[a.hash,a.id]);
    if(!live.rowCount)throw fail(401,"UNAUTHENTICATED");
    return (await db.query("SELECT vpo_stage.demo_student_action($1,$2,$3::uuid,$4::jsonb) AS value",[a.id,op,obj,JSON.stringify(b)])).rows[0].value;
   });
   return reply(res,list?200:201,{mode:"synthetic-staging",data:value});
  }catch(e){
   if(e.code==="23505")throw fail(409,"ALREADY_RECORDED");
   if(e.code==="P0001"){if(e.message==="NOT_FOUND")throw fail(404,"NOT_FOUND");if(e.message==="FORBIDDEN")throw fail(403,"FORBIDDEN");throw fail(409,"WORKFLOW_REJECTED");}
   throw e;
  }
 }

 // V4.7 student Academy: all enrolment scope originates from authenticated session.
 const academyMatch=/^\/me\/academy\/([^/]+)\/(portfolio|completion|submissions)$/.exec(path);
 if((path==="/me/academy"&&req.method==="GET")||academyMatch){
  const a=await auth(req);let op="courses",obj=null,b={};
  if(academyMatch){
   obj=academyMatch[1];if(!P.uuid(obj))throw fail(404,"NOT_FOUND");
   const sub=academyMatch[2];
   if(sub==="portfolio"&&req.method==="GET")op="portfolio";
   else if(req.method==="POST"&&["completion","submissions"].includes(sub)){
    requireCsrf(req,a);op=sub==="completion"?"complete":"submit";
    b=await body(req,65536);
    if(!(op==="complete"?A.validCompletion(b):A.validSubmission(b)))throw fail(422,"INVALID_INPUT");
    await limit("academy:"+a.id,60);
   }else throw fail(405,"METHOD_NOT_ALLOWED");
  }
  try{
   const data=await tx(async db=>{
    const live=await db.query("SELECT 1 FROM vpo_stage.sessions s JOIN vpo_stage.users u ON u.id=s.user_id JOIN vpo_stage.role_grants g ON g.user_id=u.id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND s.idle_until>clock_timestamp() AND u.status='ACTIVE' AND g.role='student' AND g.revoked_at IS NULL",[a.hash,a.id]);
    if(!live.rowCount)throw fail(401,"UNAUTHENTICATED");
    return (await db.query("SELECT vpo_stage.academy_student($1,$2,$3::uuid,$4::jsonb) AS value",[a.id,op,obj,JSON.stringify(b)])).rows[0].value;
   });
   return reply(res,op==="submit"&&!data.replayed?201:200,{mode:"synthetic-staging",data,...(op==="portfolio"?{analytics:A.analytics(data)}:{})});
  }catch(e){
   if(e.code==="23505")throw fail(409,"ALREADY_RECORDED");
   if(e.code==="P0001"){if(e.message==="NOT_FOUND")throw fail(404,"NOT_FOUND");if(e.message==="FORBIDDEN")throw fail(403,"FORBIDDEN");throw fail(409,"ACADEMY_REJECTED");}
   throw e;
  }
 }
 throw fail(404,"NOT_FOUND");
}
async function main(){dummy=await S.hashPassword(S.hex(32));await q("SELECT 1");const server=http.createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:5000,keepAliveTimeout:3000},(req,res)=>{handle(req,res).catch(e=>{if(!e.status)console.error("Unhandled request error");if(!res.headersSent&&!res.destroyed)reply(res,e.status||500,{error:e.code&&e.status?e.code:"INTERNAL_ERROR"},e.status===429?{"Retry-After":"900"}:{});});});server.maxConnections=100;server.listen(c.port,"127.0.0.1",()=>console.log("VPO synthetic staging listening on loopback"));const cleanup=setInterval(()=>{q("DELETE FROM vpo_stage.login_limits WHERE window_start<now()-interval '1 day'").catch(()=>{});q("DELETE FROM vpo_stage.sessions WHERE expires_at<now() OR idle_until<now()").catch(()=>{});},3600000);cleanup.unref();let sweeping=false;const examSweep=setInterval(async()=>{if(sweeping)return;sweeping=true;try{await tx(E.sweep);}catch{console.error("Synthetic exam sweep failed");}finally{sweeping=false;}},5000);examSweep.unref();for(const sig of ["SIGTERM","SIGINT"])process.once(sig,()=>{clearInterval(cleanup);clearInterval(examSweep);server.close(()=>pool.end().finally(()=>process.exit(0)));});}
main().catch(()=>{console.error("Startup failed; check local configuration and database");process.exitCode=1;pool.end().catch(()=>{});});