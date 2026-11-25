"use strict";
const uuid=v=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const keys=(b,k)=>b&&typeof b==="object"&&!Array.isArray(b)&&Object.keys(b).sort().join(",")===k;
const seq=v=>Number.isInteger(v)&&v>=0&&v<2147483646;
const validDraft=b=>keys(b,"body,expected_seq,op_id")&&seq(b.expected_seq)&&uuid(b.op_id)&&typeof b.body==="string"&&Buffer.byteLength(b.body,"utf8")<=40000&&!b.body.includes("\u0000")&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(b.body);
const validSubmit=b=>keys(b,"expected_seq")&&seq(b.expected_seq);
const validEvent=b=>keys(b,"event_id,kind")&&uuid(b.event_id)&&["HIDDEN","VISIBLE","RECONNECTED"].includes(b.kind);
const due=(a,now)=>a.state==="ACTIVE"&&new Date(now).getTime()>=new Date(a.deadline).getTime();
const draftDecision=(a,b,prior,now)=>{
 if(prior)return prior.seq===b.expected_seq+1&&prior.body===b.body?"REPLAY":"OP_CONFLICT";
 if(a.state!=="ACTIVE"||due(a,now))return "CLOSED";
 if(a.latest_seq!==b.expected_seq)return "STALE";
 return "SAVE";
};
const submitDecision=(a,b,now)=>a.state!=="ACTIVE"?"REPLAY":due(a,now)?"DEADLINE":a.latest_seq!==b.expected_seq?"STALE":"SUBMIT";
module.exports={uuid,validDraft,validSubmit,validEvent,due,draftDecision,submitDecision};