"use strict";
const {randomUUID}=require("node:crypto");
const P=require("./exam-policy.cjs");
const result=(status,value)=>({status,value});
const clock=async db=>(await db.query("SELECT clock_timestamp() AS now")).rows[0].now;
const publicAttempt=(a,now)=>({id:a.id,state:a.state,started_at:a.started_at,deadline:a.deadline,server_now:now,latest_seq:a.latest_seq,mode:"synthetic-staging"});
async function lockAttempt(db,id,user){return (await db.query("SELECT * FROM vpo_stage.demo_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,user])).rows[0];}
async function receipt(db,id){return (await db.query("SELECT receipt_id,seq,reason,submitted_at FROM vpo_stage.demo_submissions WHERE attempt_id=$1",[id])).rows[0]||null;}
async function finish(db,a,now,reason){
 if(a.state!=="ACTIVE")return receipt(db,a.id);
 const r=await db.query("INSERT INTO vpo_stage.demo_submissions(attempt_id,seq,reason,submitted_at) VALUES($1,$2,$3,$4) RETURNING receipt_id,seq,reason,submitted_at",[a.id,a.latest_seq,reason,now]);
 a.state=reason==="DEADLINE"?"EXPIRED":"SUBMITTED";
 await db.query("UPDATE vpo_stage.demo_attempts SET state=$2 WHERE id=$1",[a.id,a.state]);
 return r.rows[0];
}
async function settle(db,a,now){if(P.due(a,now))await finish(db,a,now,"DEADLINE");}
async function round(db,id,user){return (await db.query("SELECT r.* FROM vpo_stage.demo_rounds r JOIN vpo_stage.demo_enrolments e ON e.round_id=r.id WHERE r.id=$1 AND e.user_id=$2",[id,user])).rows[0];}
async function preflight(db,id,user){
 const r=await round(db,id,user);if(!r)return result(404,{error:"ROUND_NOT_FOUND"});
 const now=await clock(db);
 const a=(await db.query("SELECT id,state FROM vpo_stage.demo_attempts WHERE round_id=$1 AND user_id=$2",[id,user])).rows[0];
 return result(200,{round_id:id,label:r.label,opens_at:r.opens_at,closes_at:r.closes_at,duration_seconds:r.duration_seconds,server_now:now,may_start:now>=r.opens_at&&now<r.closes_at&&!a,attempt:a||null,mode:"synthetic-staging"});
}
async function start(db,id,user){
 const r=await round(db,id,user);if(!r)return result(404,{error:"ROUND_NOT_FOUND"});
 const now=await clock(db);
 // Unique constraint serializes concurrent starts; no extra attempt on retry.
 let a=(await db.query("SELECT * FROM vpo_stage.demo_attempts WHERE round_id=$1 AND user_id=$2 FOR UPDATE",[id,user])).rows[0];
 if(!a){
  if(now<r.opens_at||now>=r.closes_at)return result(409,{error:"ROUND_CLOSED"});
  const inserted=await db.query("INSERT INTO vpo_stage.demo_attempts(round_id,user_id,started_at,deadline,topic_snapshot) SELECT id,$2,clock_timestamp(),LEAST(closes_at,clock_timestamp()+duration_seconds*interval '1 second'),topic FROM vpo_stage.demo_rounds WHERE id=$1 AND clock_timestamp()>=opens_at AND clock_timestamp()<closes_at ON CONFLICT(round_id,user_id) DO NOTHING RETURNING *",[id,user]);
  a=inserted.rows[0];
  if(a){await db.query("INSERT INTO vpo_stage.demo_drafts(attempt_id,seq,op_id,body,saved_at) VALUES($1,0,$2,'',$3)",[a.id,randomUUID(),a.started_at]);return result(201,publicAttempt(a,await clock(db)));}
  a=(await db.query("SELECT * FROM vpo_stage.demo_attempts WHERE round_id=$1 AND user_id=$2 FOR UPDATE",[id,user])).rows[0];
  if(!a)return result(409,{error:"ROUND_CLOSED"});
 }
 const after=await clock(db);await settle(db,a,after);return result(200,publicAttempt(a,after));
}
async function attempt(db,id,user,action,b){
 const a=await lockAttempt(db,id,user);if(!a)return result(404,{error:"ATTEMPT_NOT_FOUND"});
 const now=await clock(db);await settle(db,a,now);
 const info=()=>publicAttempt(a,now);
 if(action==="status")return result(200,info());
 if(action==="topics")return a.state==="ACTIVE"?result(200,{...info(),topic:a.topic_snapshot}):result(410,{error:"CLOSED",...info()});
 if(action==="draft-get"){
  const d=(await db.query("SELECT seq,body,saved_at FROM vpo_stage.demo_drafts WHERE attempt_id=$1 AND seq=$2",[id,a.latest_seq])).rows[0];
  return result(200,{...info(),draft:d});
 }
 if(action==="receipt"){const r=await receipt(db,id);return r?result(200,{...info(),receipt:r}):result(404,{error:"NO_RECEIPT"});}
 if(action==="draft-put"){
  const prior=(await db.query("SELECT seq,body,saved_at FROM vpo_stage.demo_drafts WHERE attempt_id=$1 AND op_id=$2",[id,b.op_id])).rows[0];
  const decision=P.draftDecision(a,b,prior,now);
  if(decision==="REPLAY")return result(200,{...info(),ack_seq:prior.seq,saved_at:prior.saved_at,replayed:true});
  if(decision==="OP_CONFLICT"||decision==="STALE")return result(409,{error:decision,...info()});
  if(decision==="CLOSED")return result(410,{error:"CLOSED",...info(),receipt:await receipt(db,id)});
  const next=a.latest_seq+1;
  await db.query("INSERT INTO vpo_stage.demo_drafts(attempt_id,seq,op_id,body,saved_at) VALUES($1,$2,$3,$4,$5)",[id,next,b.op_id,b.body,now]);
  await db.query("UPDATE vpo_stage.demo_attempts SET latest_seq=$2 WHERE id=$1",[id,next]);a.latest_seq=next;
  return result(200,{...info(),ack_seq:next,saved_at:now,replayed:false});
 }
 if(action==="submit"){
  const decision=P.submitDecision(a,b,now);
  if(decision==="REPLAY")return result(200,{...info(),receipt:await receipt(db,id)});
  if(decision==="STALE")return result(409,{error:"STALE",...info()});
  const r=await finish(db,a,now,decision==="DEADLINE"?"DEADLINE":"MANUAL");
  return result(201,{...info(),receipt:r});
 }
 if(action==="event"){
  if(a.state!=="ACTIVE")return result(410,{error:"CLOSED"});
  const existing=(await db.query("SELECT kind FROM vpo_stage.demo_events WHERE attempt_id=$1 AND event_id=$2",[id,b.event_id])).rows[0];
  if(existing)return existing.kind===b.kind?result(202,{recorded:true,replayed:true}):result(409,{error:"EVENT_CONFLICT"});
  const n=(await db.query("SELECT count(*)::int AS n FROM vpo_stage.demo_events WHERE attempt_id=$1",[id])).rows[0].n;
  if(n>=120)return result(429,{error:"EVENT_LIMIT"});
  await db.query("INSERT INTO vpo_stage.demo_events(attempt_id,event_id,kind,received_at) VALUES($1,$2,$3,$4)",[id,b.event_id,b.kind,now]);
  return result(202,{recorded:true,replayed:false});
 }
 return result(404,{error:"NOT_FOUND"});
}
async function sweep(db){
 const rows=(await db.query("SELECT * FROM vpo_stage.demo_attempts WHERE state='ACTIVE' AND deadline<=clock_timestamp() ORDER BY deadline LIMIT 20 FOR UPDATE SKIP LOCKED")).rows;
 for(const a of rows){const now=await clock(db);await settle(db,a,now);}
 return rows.length;
}
module.exports={preflight,start,attempt,sweep};