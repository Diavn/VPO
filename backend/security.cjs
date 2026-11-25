"use strict";
const crypto=require("node:crypto");
const {promisify}=require("node:util");
const scrypt=promisify(crypto.scrypt);
const opts={N:32768,r:8,p:3,maxmem:96*1024*1024};
const hex=(n)=>crypto.randomBytes(n).toString("hex");
const digest=s=>crypto.createHash("sha256").update(s).digest("hex");
const eq=(a,b)=>typeof a==="string"&&typeof b==="string"&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const validPassword=p=>typeof p==="string"&&Buffer.byteLength(p)>=15&&Buffer.byteLength(p)<=256;
async function hashPassword(p){if(!validPassword(p))throw Error("Password must be 15–256 UTF-8 bytes");const salt=hex(16);return "s1:"+salt+":"+(await scrypt(p,salt,64,opts)).toString("hex");}
async function verifyPassword(p,h){if(!validPassword(p)||!/^s1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(h||""))return false;const [,salt,key]=h.split(":");return eq((await scrypt(p,salt,64,opts)).toString("hex"),key);}
const validEmail=e=>typeof e==="string"&&e.length<=120&&/^[a-z0-9][a-z0-9._+-]*@example\.test$/.test(e);
const csrf=(token,key)=>crypto.createHmac("sha256",key).update("csrf:"+token).digest("hex");
const accountBucket=(email,key)=>crypto.createHmac("sha256",key).update("rate:"+email).digest("hex");
function readToken(cookie,name){if(typeof cookie!=="string"||cookie.length>4096)return null;const hits=cookie.split(";").map(v=>v.trim()).filter(v=>v.startsWith(name+"="));if(hits.length!==1)return null;const token=hits[0].slice(name.length+1);return /^[a-f0-9]{64}$/.test(token)?token:null;}
function config(env){if(env.VPO_MODE!=="synthetic-staging")throw Error("Synthetic staging only");const u=new URL(env.VPO_ORIGIN||"");if(u.origin!==env.VPO_ORIGIN||!(u.protocol==="https:"||(u.protocol==="http:"&&u.hostname==="localhost")))throw Error("Set an exact HTTPS origin, or http://localhost:PORT for local staging");if(!/^[a-f0-9]{64}$/i.test(env.VPO_CSRF_KEY||""))throw Error("VPO_CSRF_KEY requires 32 random bytes, hex encoded");if(!env.DATABASE_URL)throw Error("DATABASE_URL required");const port=Number(env.VPO_PORT||8080);if(!Number.isInteger(port)||port<1024||port>65535)throw Error("Invalid port");return {origin:u.origin,host:u.host,secure:u.protocol==="https:",cookie:u.protocol==="https:"?"__Host-vpo_session":"vpo_local_session",key:Buffer.from(env.VPO_CSRF_KEY,"hex"),port};}
function profilePatch(b){if(!b||typeof b!=="object"||Array.isArray(b)||Object.keys(b).sort().join(",")!=="curriculum,grade,locale,version")return null;if(!["10","11","12"].includes(b.grade)||!["DEMO-VN","DEMO-IB","DEMO-ALEVEL"].includes(b.curriculum)||!["vi","en"].includes(b.locale)||!Number.isInteger(b.version)||b.version<1||b.version>=2147483647)return null;return b;}
module.exports={hex,digest,eq,validPassword,hashPassword,verifyPassword,validEmail,csrf,accountBucket,readToken,config,profilePatch};