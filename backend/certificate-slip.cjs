"use strict";
// Anonymous synthetic verification slip, never an official award certificate.
const {PDFDocument,StandardFonts,rgb}=require("pdf-lib"),QR=require("qrcode");
const awards={FIRST:"First Prize",SECOND:"Second Prize",THIRD:"Third Prize",HONORABLE_MENTION:"Honorable Mention"};
function verificationUrl(token,config,env){
 if(!/^[a-f0-9]{64}$/.test(token)||config.port!==8080)throw Error("Invalid demo certificate");
 let origin;
 if(config.proxyLoopback&&env.CODESPACES==="true"&&/^[a-zA-Z0-9-]+$/.test(env.CODESPACE_NAME||"")&&/^[a-zA-Z0-9.-]+$/.test(env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN||"")&&config.origin==="https://"+env.CODESPACE_NAME+"-8080."+env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN)origin="https://"+env.CODESPACE_NAME+"-8091."+env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
 else if(config.origin==="http://localhost:8080")origin="http://localhost:8091";
 else throw Error("Unsupported synthetic origin");
 return origin+"/verify-demo#"+token;
}
function matrix(url){return QR.create(url,{errorCorrectionLevel:"M"}).modules;}
async function renderSlip(value,token,config,env,now=new Date()){
 if(value?.mode!=="synthetic"||value.status!=="VALID_DEMO"||!Object.hasOwn(awards,value.award))throw Error("Valid demo award required");
 const issued=new Date(value.issued_at);if(!Number.isFinite(issued.getTime())||!Number.isFinite(now.getTime()))throw Error("Invalid date");
 const url=verificationUrl(token,config,env),qr=matrix(url),doc=await PDFDocument.create();
 doc.setTitle("VPO - DEMO verification slip");doc.setAuthor("VPO synthetic staging");doc.setSubject("NOT AN OFFICIAL CERTIFICATE");doc.setCreationDate(now);doc.setModificationDate(now);
 const page=doc.addPage([842,595]),regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),navy=rgb(.078,.173,.275),gold=rgb(.714,.604,.388),red=rgb(.647,.188,.212),black=rgb(0,0,0);
 page.drawRectangle({x:20,y:20,width:802,height:555,borderColor:navy,borderWidth:2});
 page.drawRectangle({x:28,y:28,width:786,height:539,borderColor:gold,borderWidth:1});
 const center=(text,y,size,font=regular,color=navy)=>page.drawText(text,{x:(842-font.widthOfTextAtSize(text,size))/2,y,size,font,color});
 center("VIETNAM PHILOSOPHY OLYMPIAD",526,20,bold);
 center("DEMO ONLY - NOT AN OFFICIAL CERTIFICATE",487,22,bold,red);
 center("Synthetic award verification slip",448,22,bold);
 center(awards[value.award],398,30,bold);
 center("Anonymous test record - no recipient identity",366,14);
 center("Issued (UTC): "+issued.toISOString(),337,12);
 center("Status checked (UTC): "+now.toISOString(),315,12);
 const size=176,unit=size/(qr.size+8),x=(842-size)/2,y=115;
 page.drawRectangle({x,y,width:size,height:size,color:rgb(1,1,1)});
 for(let row=0;row<qr.size;row++)for(let col=0;col<qr.size;col++)if(qr.get(row,col))page.drawRectangle({x:x+(col+4)*unit,y:y+(qr.size-row+3)*unit,width:unit,height:unit,color:black});
 center("Scan in the same private staging environment to recheck status.",91,11);
 center("This snapshot can become invalid; always verify live status.",70,11,bold,red);
 center("Disposable staging only. Not evidence of achievement or eligibility.",48,10);
 return Buffer.from(await doc.save());
}
module.exports={verificationUrl,matrix,renderSlip};
