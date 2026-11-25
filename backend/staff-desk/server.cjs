"use strict";
// Disposable single-role staff desk. Local tunnel only; never a production authentication service.
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{Pool}=require("pg"),W=require("../workflow-policy.cjs");
const roles={ci_exam_a:["queue","read_assigned","lock_mark"],ci_exam_b:["queue","read_assigned","lock_mark"],ci_moderator:["queue","moderation_detail","propose"],ci_approver:["queue","approve"],ci_publisher:["queue","publish"],ci_finance:["queue","reconcile"],ci_appeal:["queue","appeal_decide"],ci_cert:["queue","cert_issue","cert_revoke_request"],ci_cert_approver:["queue","cert_revoke_approve"]};
const e=process.env,origin="http://localhost:8081",role=e.VPO_DESK_ROLE,key=e.VPO_DESK_KEY;
if(e.VPO_MODE!=="synthetic-staging"||!(e.CODESPACES==="true"||e.GITHUB_ACTIONS==="true")||!Object.hasOwn(roles,role)||! /^[a-f0-9]{64}$/.test(key||""))throw Error("Synthetic single role only");
const db=new URL(e.DATABASE_URL);if(db.protocol!=="postgresql:"||db.hostname!=="127.0.0.1"||db.port!=="5432"||db.pathname!=="/vpo_ci"||db.username!==role||db.search||db.hash)throw Error("Local disposable role required");
const pool=new Pool({connectionString:e.DATABASE_URL,max:2,connectionTimeoutMillis:3000,statement_timeout:10000});
const assets={"/":["desk.html","text/html; charset=utf-8"],"/desk.js":["desk.js","text/javascript; charset=utf-8"],"/desk.css":["desk.css","text/css; charset=utf-8"]};
let hits=0,windowStart=Date.now(),inflight=0;
function answer(res,status,data,type="application/json; charset=utf-8"){res.writeHead(status,{"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"same-origin","Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});res.end(type.startsWith("application/json")?JSON.stringify(data):data);}
function auth(req){const a=req.headers.authorization||"";const expected="Bearer "+key;return typeof a==="string"&&a.length===expected.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(expected));}
async function main(){
 const r=await pool.query("SELECT session_user AS actor,current_database() AS db");if(r.rows[0].actor!==role||r.rows[0].db!=="vpo_ci")throw Error("Wrong role/database");
 const server=http.createServer({requestTimeout:10000,headersTimeout:5000,maxHeaderSize:8192},async(req,res)=>{
  try{
   if(req.headers.host!=="localhost:8081")return answer(res,421,{error:"HOST"});
   const assetPath=req.method==="GET"&&typeof req.url==="string"&&req.url.length<=2048?req.url.split("?",1)[0]:null;
   if(assetPath!==null&&Object.hasOwn(assets,assetPath)){const [file,type]=assets[assetPath];return answer(res,200,fs.readFileSync(path.join(__dirname,file)),type);}
   if(req.method!=="POST"||req.url!=="/api/action")return answer(res,404,{error:"NOT_FOUND"});
   if(req.headers.origin!==origin)return answer(res,403,{error:"ORIGIN"});
   if(Date.now()-windowStart>=60000){windowStart=Date.now();hits=0;}if(++hits>120)return answer(res,429,{error:"RATE"});
   if(!auth(req))return answer(res,401,{error:"UNAUTHORIZED"});
   if(req.headers["content-type"]!=="application/json"||req.headers["content-encoding"])return answer(res,415,{error:"JSON_REQUIRED"});
   if(Number(req.headers["content-length"]||0)>8192)return answer(res,413,{error:"TOO_LARGE"});
   if(inflight>=4)return answer(res,429,{error:"BUSY"});
   inflight++;
   try{
    const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>8192)return answer(res,413,{error:"TOO_LARGE"});chunks.push(c);}
    let x;try{x=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}catch{return answer(res,400,{error:"JSON"});}
    if(!x||Array.isArray(x)||Object.keys(x).sort().join(",")!=="body,id,op"||!roles[role].includes(x.op)||!W.validateStaff(x.op,x.id,x.body))return answer(res,422,{error:"ROLE_OR_INPUT"});
    const q=await pool.query("SELECT vpo_stage.demo_staff_action($1,$2::uuid,$3::jsonb) AS value",[x.op,x.id,JSON.stringify(x.body)]);
    return answer(res,200,{role,data:q.rows[0].value});
   }finally{inflight--;}
  }catch{if(!res.headersSent&&!res.destroyed)answer(res,409,{error:"OPERATION_REFUSED"});}
 });
 server.listen(8081,"127.0.0.1",()=>console.log("Synthetic staff desk ready: "+role));server.on("error",()=>{console.error("Staff desk startup failed");process.exit(1);});
 process.on("SIGTERM",()=>{server.close(()=>pool.end().finally(()=>process.exit(0)));setTimeout(()=>process.exit(1),5000).unref();});
}
main().catch(()=>{console.error("Staff desk startup refused");process.exit(1);});