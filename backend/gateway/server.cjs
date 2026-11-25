"use strict";
// Synthetic single-entry portal. No database credentials, no arbitrary upstream URLs.
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),S=require("../security.cjs");
const e=process.env;
if(!(e.GITHUB_ACTIONS==="true"||e.CODESPACES==="true")||e.VPO_MODE!=="synthetic-staging")throw Error("Synthetic gateway only");
const c=S.config({...e,VPO_PORT:"8091",DATABASE_URL:"gateway-no-database",VPO_CSRF_KEY:crypto.randomBytes(32).toString("hex")});
if(c.secure&&!c.proxyLoopback)throw Error("Only configured private Codespaces or local desktop");
if(!c.secure&&c.origin!=="http://localhost:8091")throw Error("Exact local origin required");
function upstreamOrigin(port){return c.secure?"https://"+e.CODESPACE_NAME+"-"+port+"."+e.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:"http://localhost:"+port;}
const root=path.resolve(__dirname,"../.."),pages=["index","about","competition","results","knowledge","library","academy","community","news","support"];
const files=new Set([...pages.map(x=>x+".html"),"styles.css","app.js","portal.css","portal.js","brand/vpo-mark.svg","brand/vpo-horizontal.svg","brand/vpo-horizontal-dark.svg"]);
const accountPages=new Set(["/admin","/admin/","/register","/register/","/reset","/accounts.css","/accounts.js"]);
const accountAPI=new Set(["/api/admin/login","/api/admin/logout","/api/admin/users","/api/admin/invite","/api/admin/change","/api/admin/overview","/api/admin/rounds","/api/admin/audit","/api/admin/round-create","/api/admin/enrol","/api/register/request","/api/register/verify","/api/reset/request","/api/reset/verify"]);
const studentPages=new Set(["/staging","/staging.css","/staging.js","/exam-demo","/exam-demo.css","/exam-demo.js","/academy-demo","/academy-demo.css","/academy-demo.js"]);
const uuid="[a-fA-F0-9-]{36}";
const studentAPI=[/^\/auth\/(login|logout)$/,/^\/me(?:\/profile|\/orders|\/results|\/academy)?$/,new RegExp("^/rounds/"+uuid+"/(preflight|attempts)$"),new RegExp("^/attempts/"+uuid+"(?:/(topics|draft|submit|receipt|events))?$"),new RegExp("^/me/orders/"+uuid+"/report$"),new RegExp("^/me/results/"+uuid+"/appeal$"),new RegExp("^/me/academy/"+uuid+"/(portfolio|completion|submissions)$"),/^\/public\/certificates\/[a-f0-9]{64}$/];
const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml"};
function headers(type){return {"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Permissions-Policy":"camera=(), microphone=(), geolocation=()","Cross-Origin-Resource-Policy":"same-origin","Content-Security-Policy":"default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-ancestors 'none'",...(c.secure?{"Strict-Transport-Security":"max-age=31536000"}:{})};}
function reply(res,status,body){res.writeHead(status,headers("application/json; charset=utf-8"));res.end(JSON.stringify(body));}
function redirect(res,loc){res.writeHead(302,{...headers("text/plain"),Location:loc});res.end();}
function upstream(port,url,method,body,h){return new Promise((resolve,reject)=>{
 const origin=upstreamOrigin(port),forward={Host:new URL(origin).host};
 if(method!=="GET")forward.Origin=origin;
 if(body.length||h["content-type"]){forward["Content-Length"]=body.length;if(h["content-type"])forward["Content-Type"]=h["content-type"];}
 if(port===8082&&typeof h.authorization==="string")forward.Authorization=h.authorization;
 if(port===8080){const name=c.secure?"__Host-vpo_session":"vpo_local_session";const token=S.readToken(h.cookie,name);if(token)forward.Cookie=name+"="+token;if(typeof h["x-csrf-token"]==="string")forward["X-CSRF-Token"]=h["x-csrf-token"];}
 const q=http.request({hostname:"127.0.0.1",port,path:url,method,headers:forward},r=>{const chunks=[];let n=0;r.on("data",b=>{n+=b.length;if(n>2*1024*1024)r.destroy(Error("Upstream too large"));else chunks.push(b);});r.on("error",reject);r.on("end",()=>resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(chunks)}));});
 q.on("error",reject);q.setTimeout(18000,()=>q.destroy(Error("Upstream timeout")));q.end(body);
});}
async function handle(req,res){
 if(!S.hostAllowed(req.headers.host,c))return reply(res,421,{error:"HOST"});
 if(typeof req.url!=="string"||req.url.length>2048||!req.url.startsWith("/")||req.url.startsWith("//"))return reply(res,400,{error:"PATH"});
 const route=req.url.split("?",1)[0],method=req.method;
 if(!["GET","POST","PATCH","PUT"].includes(method))return reply(res,405,{error:"METHOD"});
 if(method!=="GET"&&!S.originAllowed(req.headers,c)){console.error("ORIGIN_REJECTED",S.originDiagnostic(req.headers,c));return reply(res,403,{error:"ORIGIN"});}
 if(method==="GET"&&["/","/VPO","/VPO/"].includes(route))return redirect(res,"/VPO/index.html");
 if(method==="GET"&&route==="/VPO/portal.html")return redirect(res,"/staging");
 if(method==="GET"&&route==="/healthz"){try{const r=await Promise.all([8080,8082].map(p=>upstream(p,"/healthz","GET",Buffer.alloc(0),{})));return reply(res,r.every(x=>x.status===200)?200:503,{mode:"synthetic-staging",student:r[0].status,accounts:r[1].status});}catch{return reply(res,503,{error:"UPSTREAM_UNAVAILABLE"});}}
 if(method==="GET"&&route.startsWith("/VPO/")&&files.has(route.slice(5))){
  const file=route.slice(5);let b=fs.readFileSync(path.join(root,file));
  if(file.endsWith(".html"))b=Buffer.from(b.toString("utf8").replace("</header>",'</header><nav class="wrap actions" aria-label="Private staging services"><a href="/staging">Student Dashboard</a> <a href="/register">Register / Đăng ký mẫu</a> <a href="/admin">Admin</a></nav>'));
  res.writeHead(200,headers(mime[path.extname(file)]));return res.end(b);
 }
 let port=0;
 if(method==="GET"&&accountPages.has(route))port=8082;
 else if(method==="GET"&&studentPages.has(route))port=8080;
 else if(req.url===route&&accountAPI.has(route)&&method==="POST")port=8082;
 else if(req.url===route&&studentAPI.some(r=>r.test(route)))port=8080;
 if(!port)return reply(res,404,{error:"NOT_FOUND"});
 if(req.headers["content-encoding"]||Number(req.headers["content-length"]||0)>65536)return reply(res,413,{error:"BODY_LIMIT"});
 const chunks=[];let n=0;for await(const b of req){n+=b.length;if(n>65536)return reply(res,413,{error:"BODY_LIMIT"});chunks.push(b);}
 const r=await upstream(port,req.url,method,Buffer.concat(chunks),req.headers);
 if(r.status>=400&&accountAPI.has(route))console.error("ACCOUNT_UPSTREAM_STATUS",JSON.stringify({route,status:r.status}));
 const out=headers(r.headers["content-type"]||"application/octet-stream");
 // Do not append a differently-cased duplicate CSP: browsers enforce both policies.
 if(r.headers["content-security-policy"])out["Content-Security-Policy"]=r.headers["content-security-policy"];
 if(r.headers["retry-after"])out["Retry-After"]=r.headers["retry-after"];
 if(port===8080&&r.headers["set-cookie"])out["set-cookie"]=r.headers["set-cookie"];
 res.writeHead(r.status,out);res.end(r.body);
}
const server=http.createServer({maxHeaderSize:8192,requestTimeout:15000,headersTimeout:5000,keepAliveTimeout:3000},(req,res)=>handle(req,res).catch(err=>{console.error("GATEWAY_FAILURE",["ECONNREFUSED","ECONNRESET","ETIMEDOUT","EPIPE","ERR_HTTP_INVALID_HEADER_VALUE","ERR_INVALID_ARG_TYPE"].includes(err.code)?err.code:err.name);if(!res.headersSent&&!res.destroyed)reply(res,502,{error:"UPSTREAM_UNAVAILABLE"});}));
server.maxConnections=100;server.listen(8091,"127.0.0.1",()=>console.log("Synthetic unified portal ready"));server.on("error",()=>process.exit(1));process.once("SIGTERM",()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();});
