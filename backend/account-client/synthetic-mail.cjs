"use strict";
// Local disposable synthetic delivery only. No network, no real email, no provider credentials.
const fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto");
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function mailbox(dir){
 if(!fs.lstatSync(dir).isDirectory()||(fs.statSync(dir).mode&0o077)!==0)throw Error("Private synthetic mailbox required");
 const file=id=>{if(typeof id!=="string"||!uuid.test(id))throw Error("Invalid synthetic message id");return path.join(dir,id+".json");};
 function deliver(message){
  if(!message||typeof message.to!=="string"||!/^[-a-z0-9][a-z0-9._+-]*@example\.test$/.test(message.to)||!/^\d{8}$/.test(message.code)||message.expires_in_seconds!==600||!["VPO synthetic verification","VPO synthetic password reset"].includes(message.subject))throw Error("Synthetic message only");
  const target=file(message.challenge_id),tmp=path.join(dir,".pending-"+randomUUID()),body=JSON.stringify(message);
  try{
   fs.writeFileSync(tmp,body,{mode:0o600,flag:"wx",flush:true});
   // Hard link is atomic and fails if target already exists; never overwrite an existing message.
   try{fs.linkSync(tmp,target);}catch(err){if(err.code!=="EEXIST")throw err;const st=fs.lstatSync(target);if(!st.isFile()||(st.mode&0o077)!==0||fs.readFileSync(target,"utf8")!==body)throw Error("Conflicting synthetic delivery");}
  }finally{fs.rmSync(tmp,{force:true});}
 }
 function remove(id){fs.rmSync(file(id),{force:true});}
 function purge(now=Date.now()){
  let removed=0;
  for(const name of fs.readdirSync(dir)){
   if(!uuid.test(name.replace(/\.json$/,""))||!name.endsWith(".json"))continue;
   const target=path.join(dir,name);
   try{const st=fs.lstatSync(target);if(st.isFile()&&now-st.mtimeMs>=600000){fs.unlinkSync(target);removed++;}}catch(err){if(err.code!=="ENOENT")throw err;}
  }
  return removed;
 }
 return {deliver,remove,purge};
}
module.exports={mailbox};
