"use strict";
// Synthetic account service. No real SMTP, no production configuration.
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{Pool}=require("pg"),S=require("../security.cjs"),P=require("../exam-policy.cjs");
const e=process.env,c=S.config({...e,VPO_PORT:"8082"}),adminHash=e.VPO_ADMIN_HASH,mailDir=e.VPO_MAIL_DIR,mailKey=e.VPO_MAIL_KEY;
if(!(e.CODESPACES==="true"||e.GITHUB_ACTIONS==="true")||!/^s1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(adminHash||"")||! /^[a-f0-9]{64}$/.test(mailKey||"")||!mailDir)throw Error("Synthetic configuration required");
const url=new URL(e.DATABASE_URL);if(url.hostname!=="127.0.0.1"||url.port!=="5432"||url.username!=="vpo_accounts"||url.pathname!=="/vpo_ci"||url.protocol!=="postgresql:"||url.search||url.hash)throw Error("Disposable DB only");
if(!fs.statSync(mailDir).isDirectory()||(fs.statSync(mailDir).mode&0o077)!==0)throw Error("Private synthetic mailbox required");
const db=new Pool({connectionString:e.DATABASE_URL,max:4,statement_timeout:5000,connectionTimeoutMillis:3000});
const assets={"/":["admin.html","text/html"],"/admin/":["admin.html","text/html"],"/register/":["register.html","text/html"],"/admin":["admin.html","text/html"],"/register":["register.html","text/html"],"/accounts.js":["accounts.js","text/javascript"],"/accounts.css":["accounts.css","text/css"]};
const sessions=new Map(),limits=new Map();let hashing=0,requests=0,windowStart=Date.now();
const fail=(status,code)=>Object.assign(Error(code),{status,code});
const exact=(b,keys)=>b&&typeof b==="object"&&!Array.isArray(b)&&Object.keys(b).sort().join(",")===keys;
function limit(key,max,ms=900000){const now=Date.now();let v=limits.get(key);if(!v||now>=v.until){v={n:0,until:now+ms};limits.set(key,v);}if(++v.n>max)throw fail(429,"TRY_LATER");}
function mac(id,code){return crypto.createHmac("sha256",mailKey).update(id+":"+code).digest("hex");}
function send(res,status,data,type="application/json"){res.writeHead(status,{"Content-Type":type+"; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",...(c.secure?{"Strict-Transport-Security":"max-age=31536000"}:{})});res.end(type==="application/json"?JSON.stringify(data):data);}
async function body(req){if(req.headers["content-type"]!=="application/json"||req.headers["content-encoding"])throw fail(415,"JSON_REQUIRED");if(Number(req.headers["content-length"]||0)>4096)throw fail(413,"TOO_LARGE");const chunks=[];let n=0;for await(const ch of req){n+=ch.length;if(n>4096)throw fail(413,"TOO_LARGE");chunks.push(ch);}try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw fail(400,"JSON_INVALID");}}
async function hash(p){if(hashing>=2)throw fail(503,"TRY_LATER");hashing++;try{return await S.hashPassword(p);}finally{hashing--;}}
function admin(req){const raw=req.headers.authorization||"";if(!/^Bearer [a-f0-9]{64}$/.test(raw))throw fail(401,"ADMIN_REQUIRED");const k=S.digest(raw.slice(7)),expiry=sessions.get(k);if(!expiry||expiry<=Date.now()){sessions.delete(k);throw fail(401,"ADMIN_REQUIRED");}return k;}
async function begin(email){if(!S.validEmail(email))throw fail(422,"SYNTHETIC_EMAIL_REQUIRED");limit("email:"+email,3);const id=crypto.randomUUID(),code=String(crypto.randomInt(0,100000000)).padStart(8,"0");
 const r=await db.query("SELECT vpo_stage.registration_begin($1,$2,$3) AS ok",[id,email,mac(id,code)]);
 if(r.rows[0].ok){fs.writeFileSync(path.join(mailDir,id+".json"),JSON.stringify({to:email,subject:"VPO synthetic verification",challenge_id:id,code,expires_in_seconds:600}),{mode:0o600,flag:"wx"});}
 return {challenge_id:id,message:"If eligible, verification code is sent to the synthetic mailbox.",mode:"synthetic-mailbox"};
}
async function main(){
 const who=await db.query("SELECT session_user AS role,current_database() AS name");if(who.rows[0].role!=="vpo_accounts"||who.rows[0].name!=="vpo_ci")throw Error("Wrong role");
 const server=http.createServer({requestTimeout:10000,headersTimeout:5000,maxHeaderSize:8192},async(req,res)=>{
 try{
 if(!S.hostAllowed(req.headers.host,c)){console.error("HOST_REJECTED",JSON.stringify(String(req.headers.host||"").slice(0,180)));throw fail(421,"HOST");}
 const assetPath=req.method==="GET"&&typeof req.url==="string"&&req.url.length<=2048?req.url.split("?",1)[0]:null;
 if(assetPath!==null&&Object.hasOwn(assets,assetPath)){const [file,type]=assets[assetPath];return send(res,200,fs.readFileSync(path.join(__dirname,file)),type);}
 if(req.method!=="POST"){if(req.method==="GET"){const route=typeof req.url==="string"?req.url.split("?",1)[0]:"";const safe=/^\/[a-zA-Z0-9/._-]{0,100}$/.test(route)?route:"[nonstandard path redacted]";console.error("ROUTE_REJECTED",JSON.stringify({method:"GET",path:safe}));}throw fail(404,"NOT_FOUND");}
 if(req.headers.origin!==c.origin)throw fail(403,"ORIGIN");
 const now=Date.now();if(now-windowStart>=60000){windowStart=now;requests=0;for(const [k,v] of limits)if(v.until<=now)limits.delete(k);for(const [k,v] of sessions)if(v<=now)sessions.delete(k);}
 if(++requests>100)throw fail(429,"TRY_LATER");
 const b=await body(req);
 if(req.url==="/api/admin/login"){limit("admin-login",5);if(!exact(b,"password,username")||b.username!=="admin"||!S.validPassword(b.password))throw fail(401,"INVALID_CREDENTIALS");if(hashing>=2)throw fail(503,"TRY_LATER");hashing++;let ok;try{ok=await S.verifyPassword(b.password,adminHash);}finally{hashing--;}if(!ok)throw fail(401,"INVALID_CREDENTIALS");sessions.clear();const token=S.hex(32);sessions.set(S.digest(token),now+1800000);return send(res,200,{token,expires_in_seconds:1800});}
 if(req.url==="/api/register/request"){if(!exact(b,"email"))throw fail(422,"INPUT");return send(res,202,await begin(b.email));}
 if(req.url==="/api/register/verify"){limit("verify-global",40);if(!exact(b,"challenge_id,code,password")||!P.uuid(b.challenge_id)||typeof b.code!=="string"||!/^\d{8}$/.test(b.code)||!S.validPassword(b.password))throw fail(422,"INPUT");limit("verify:"+b.challenge_id,6);const r=await db.query("SELECT vpo_stage.registration_finish($1,$2,$3) AS ok",[b.challenge_id,mac(b.challenge_id,b.code),await hash(b.password)]);if(!r.rows[0].ok)throw fail(400,"INVALID_OR_EXPIRED_CODE");fs.rmSync(path.join(mailDir,b.challenge_id+".json"),{force:true});return send(res,201,{status:"ACTIVE"});}
 if(req.url.startsWith("/api/admin/")){
 const k=admin(req);
 if(req.url==="/api/admin/logout"&&exact(b,"")){sessions.delete(k);return send(res,200,{ok:true});}
 if(req.url==="/api/admin/users"&&exact(b,"search")&&typeof b.search==="string"&&b.search.length<=120){const r=await db.query("SELECT vpo_stage.account_admin_list($1) AS data",[b.search]);return send(res,200,{data:r.rows[0].data});}
 if(req.url==="/api/admin/invite"&&exact(b,"email"))return send(res,202,await begin(b.email));
 if(req.url==="/api/admin/change"&&exact(b,"id,op")&&P.uuid(b.id)&&["suspend","activate","delete"].includes(b.op)){const r=await db.query("SELECT vpo_stage.account_admin_change($1,$2) AS ok",[b.id,b.op]);if(!r.rows[0].ok)throw fail(409,"CHANGE_REFUSED");return send(res,200,{ok:true});}
 }
 throw fail(404,"NOT_FOUND");
 }catch(err){if(!res.headersSent&&!res.destroyed)send(res,err.status||500,{error:err.status?err.code:"REQUEST_FAILED"});}
 });
 server.listen(8082,"127.0.0.1",()=>console.log("Synthetic account service ready"));server.on("error",()=>process.exit(1));process.on("SIGTERM",()=>{server.close(()=>db.end().finally(()=>process.exit(0)));setTimeout(()=>process.exit(1),5000).unref();});
}
main().catch(()=>{console.error("Account service startup refused");process.exit(1);});