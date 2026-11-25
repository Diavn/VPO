"use strict";
const P=require("./exam-policy.cjs");
const exact=(x,k)=>x&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).sort().join(",")===k;
const scores=x=>Array.isArray(x)&&x.length===5&&x.every(n=>Number.isInteger(n)&&n>=0&&n<=4);
const reason=x=>typeof x==="string"&&Buffer.byteLength(x.trim(),"utf8")>=1&&Buffer.byteLength(x,"utf8")<=2000&&!x.includes("\u0000");
const award=x=>["NONE","FIRST","SECOND","THIRD","HONORABLE_MENTION"].includes(x);
const validateReport=b=>exact(b,"transfer_ref")&&typeof b.transfer_ref==="string"&&/^DEMO-[A-Z0-9]{8,32}$/.test(b.transfer_ref);
const validateAppeal=b=>exact(b,"category")&&["SCORING","PROCESS","TECHNICAL"].includes(b.category);
const validToken=t=>typeof t==="string"&&/^[a-f0-9]{64}$/.test(t);
function validateStaff(op,obj,b){
 if(op==="queue")return obj===null&&exact(b,"");
 if(!P.uuid(obj))return false;
 if(["read_assigned","moderation_detail","approve","publish","reconcile","cert_issue","cert_revoke_approve"].includes(op))return exact(b,"");
 if(op==="lock_mark")return exact(b,"reason,scores")&&reason(b.reason)&&scores(b.scores);
 if(op==="propose")return (exact(b,"award,reason")||exact(b,"adjudicated_scores,award,reason")&&scores(b.adjudicated_scores))&&award(b.award)&&reason(b.reason);
 if(op==="appeal_decide")return exact(b,"decision,reason")&&["DISMISSED","REVIEW_REQUIRED"].includes(b.decision)&&reason(b.reason);
 if(op==="cert_revoke_request")return exact(b,"reason")&&reason(b.reason);
 return false;
}
module.exports={scores,reason,award,validateReport,validateAppeal,validToken,validateStaff};