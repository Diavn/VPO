"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{PDFDocument}=require("pdf-lib"),decode=require("jsqr"),{verificationUrl,matrix,renderSlip}=require("../certificate-slip.cjs");
const token="a".repeat(64),config={port:8080,origin:"http://localhost:8080",proxyLoopback:false},value={mode:"synthetic",status:"VALID_DEMO",award:"FIRST",issued_at:"2026-11-25T10:00:00.000Z"},now=new Date("2026-11-26T00:00:00.000Z");
test("synthetic PDF parses and QR independently decodes, including private HTTPS",async()=>{
 const pdf=await renderSlip(value,token,config,{},now),doc=await PDFDocument.load(pdf);
 assert.equal(doc.getPageCount(),1);assert.deepEqual(doc.getPage(0).getSize(),{width:842,height:595});assert.equal(doc.getTitle(),"VPO - DEMO verification slip");assert.equal(doc.getSubject(),"NOT AN OFFICIAL CERTIFICATE");
 const env={CODESPACES:"true",CODESPACE_NAME:"demo-space",GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:"app.github.dev"};
 const privateConfig={port:8080,origin:"https://demo-space-8080.app.github.dev",proxyLoopback:true};
 for(const [c,e,expected] of [[config,{},"http://localhost:8091/verify-demo#"+token],[privateConfig,env,"https://demo-space-8091.app.github.dev/verify-demo#"+token]]){
  const url=verificationUrl(token,c,e);assert.equal(url,expected);
  const qr=matrix(url),scale=5,side=(qr.size+8)*scale,pixels=new Uint8ClampedArray(side*side*4).fill(255);
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.get(y,x))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const i=(((y+4)*scale+dy)*side+(x+4)*scale+dx)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;}
  assert.equal(decode(pixels,side,side)?.data,expected);
 }
});
test("PDF refuses held, revoked, non-synthetic, no award and unconfigured origin",async()=>{
 for(const v of [{...value,status:"ON_HOLD"},{...value,status:"REVOKED"},{...value,mode:"production"},{...value,award:"NONE"}])await assert.rejects(renderSlip(v,token,config,{},now));
 assert.throws(()=>verificationUrl(token,{...config,origin:"https://untrusted.example.test"},{}));
 assert.throws(()=>verificationUrl("not-a-token",config,{}));
});