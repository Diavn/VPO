"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{randomUUID}=require("node:crypto"),{mailbox}=require("../account-client/synthetic-mail.cjs");
test("synthetic mailbox: atomic same-message replay, conflict rejection, mode and expiry",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"vpo-test-mail-"));fs.chmodSync(dir,0o700);
 try{
  const m=mailbox(dir),id=randomUUID(),message={to:"fixture@example.test",subject:"VPO synthetic verification",challenge_id:id,code:"12345678",expires_in_seconds:600},target=path.join(dir,id+".json");
  m.deliver(message);m.deliver(message);
  assert.deepEqual(fs.readdirSync(dir),[id+".json"]);assert.equal(fs.statSync(target).mode&0o777,0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(target,"utf8")),message);
  assert.throws(()=>m.deliver({...message,code:"87654321"}),/Conflicting synthetic delivery/);
  assert.deepEqual(JSON.parse(fs.readFileSync(target,"utf8")),message);
  assert.throws(()=>m.deliver({...message,to:"fixture@example.com"}),/Synthetic message only/);
  assert.throws(()=>m.remove("../escape"),/Invalid synthetic message id/);
  assert.equal(m.purge(),0);fs.utimesSync(target,new Date(0),new Date(0));assert.equal(m.purge(),1);assert(!fs.existsSync(target));
  m.deliver(message);m.remove(id);m.remove(id);assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});