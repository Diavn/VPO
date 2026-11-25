"use strict";
const http=require("node:http");
const {Pool}=require("pg");
const S=require("./security.cjs");
const c=S.config(process.env);
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,statement_timeout:5000,query_timeout:6000});
pool.on("error",()=>console.error("Database pool error"));
const q=(sql,p=[])=>pool.query(sql,p);
const fail=(status,code)=>Object.assign(Error(code),{status,code});
function cookie(token,clear=false){return c.cookie+"="+(clear?"":token)+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+(clear?"0":"28800")+(c.secure?"; Secure":"");}
function reply(res,status,value,extra={}){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'; base-uri 'none'","Permissions-Policy":"camera=(), microphone=(), geolocation=()",...(c.secure?{"Strict-Transport-Security":"max-age=31536000"}:{}),...extra});res.end(JSON.stringify(value));}
async function body(req){if(req.headers["content-type"]?.split(";")[0].trim().toLowerCase()!=="application/json")throw fail(415,"JSON_REQUIRED");const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>8192)throw fail(413,"BODY_TOO_LARGE");chunks.push(part);}try{const b=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!b||typeof b!=="object"||Array.isArray(b))throw Error();return b;}catch{throw fail(400,"INVALID_JSON");}}
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
 if(!["GET","POST","PATCH"].includes(req.method))throw fail(405,"METHOD_NOT_ALLOWED");
 if(req.method!=="GET"&&req.headers.origin!==c.origin)throw fail(403,"ORIGIN_REQUIRED");
 const path=req.url;
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
 throw fail(404,"NOT_FOUND");
}
async function main(){dummy=await S.hashPassword(S.hex(32));await q("SELECT 1");const server=http.createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:5000,keepAliveTimeout:3000},(req,res)=>{handle(req,res).catch(e=>{if(!e.status)console.error("Unhandled request error");if(!res.headersSent&&!res.destroyed)reply(res,e.status||500,{error:e.code&&e.status?e.code:"INTERNAL_ERROR"},e.status===429?{"Retry-After":"900"}:{});});});server.maxConnections=100;server.listen(c.port,"127.0.0.1",()=>console.log("VPO synthetic staging listening on loopback"));const cleanup=setInterval(()=>{q("DELETE FROM vpo_stage.login_limits WHERE window_start<now()-interval '1 day'").catch(()=>{});q("DELETE FROM vpo_stage.sessions WHERE expires_at<now() OR idle_until<now()").catch(()=>{});},3600000);cleanup.unref();for(const sig of ["SIGTERM","SIGINT"])process.once(sig,()=>{clearInterval(cleanup);server.close(()=>pool.end().finally(()=>process.exit(0)));});}
main().catch(()=>{console.error("Startup failed; check local configuration and database");process.exitCode=1;pool.end().catch(()=>{});});