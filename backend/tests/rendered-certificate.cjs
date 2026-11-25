"use strict";
// CI-only rendered-document test. Fixed fictional token, never a live issuance.
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{execFileSync}=require("node:child_process"),decode=require("jsqr"),{renderSlip,verificationUrl}=require("../certificate-slip.cjs");
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"vpo-pdf-render-"));
 try{
  const token="b".repeat(64),config={port:8080,origin:"http://localhost:8080",proxyLoopback:false},value={mode:"synthetic",status:"VALID_DEMO",award:"FIRST",issued_at:"2026-11-25T10:00:00.000Z"},now=new Date("2026-11-26T00:00:00.000Z");
  const pdf=path.join(dir,"slip.pdf"),out=path.join(dir,"render");
  fs.writeFileSync(pdf,await renderSlip(value,token,config,{},now),{mode:0o600});
  const text=execFileSync("pdftotext",["-layout",pdf,"-"],{encoding:"utf8",timeout:10000});
  for(const required of ["DEMO ONLY - NOT AN OFFICIAL CERTIFICATE","First Prize","Anonymous test record","Status checked (UTC)","always verify live status"])assert(text.includes(required),"Required visible text missing: "+required);
  assert(!text.includes(token),"Raw token must not appear in text");
  execFileSync("pdftoppm",["-r","144","-singlefile",pdf,out],{timeout:15000});
  const buf=fs.readFileSync(out+".ppm"),header=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(buf.subarray(0,100).toString("ascii"));
  assert(header,"Expected P6 raster");const width=Number(header[1]),height=Number(header[2]);assert.equal(width,1684);assert.equal(height,1190);const bytes=buf.subarray(header[0].length);assert.equal(bytes.length,width*height*3);
  // Crop the actual printed QR with surrounding white quiet zone. Coordinates are 2px per PDF point.
  const left=646,top=588,side=392,rgba=new Uint8ClampedArray(side*side*4);
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){const src=((top+y)*width+left+x)*3,dst=(y*side+x)*4;rgba[dst]=bytes[src];rgba[dst+1]=bytes[src+1];rgba[dst+2]=bytes[src+2];rgba[dst+3]=255;}
  assert.equal(decode(rgba,side,side)?.data,verificationUrl(token,config,{}),"QR must decode from the rendered PDF");
  console.log("RENDERED PDF PASS: Poppler raster, visible demo warning and award text, independently decoded QR from printed page.");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error("Rendered PDF test failed:",e.name);process.exitCode=1;});
