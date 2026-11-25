"use strict";
const {Client}=require("pg"),P=require("./exam-policy.cjs"),A=require("./academy-policy.cjs");
async function main(){
 if(process.env.VPO_MODE!=="synthetic-staging"||!process.env.DATABASE_URL)throw Error("Synthetic staging only");
 const [op,raw,...extra]=process.argv.slice(2),id=raw||null;
 if(extra.length||!["queue","read","feedback"].includes(op)||(op==="queue"?id!==null:!P.uuid(id)))throw Error("Usage: node academy-mentor.cjs queue|read|feedback [submission UUID]");
 let input="";for await(const chunk of process.stdin){input+=chunk.toString();if(Buffer.byteLength(input)>8192)throw Error("Input too large");}
 const b=input.trim()?JSON.parse(input):{};
 if(op==="feedback"?!A.validFeedback(b):!b||typeof b!=="object"||Array.isArray(b)||Object.keys(b).length)throw Error("Invalid input");
 const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:10000,query_timeout:12000});
 try{await db.connect();const r=await db.query("SELECT vpo_stage.academy_mentor($1,$2::uuid,$3::jsonb) AS value",[op,id,JSON.stringify(b)]);console.log(JSON.stringify(r.rows[0].value,null,2));}finally{await db.end().catch(()=>{});}
}
main().catch(()=>{console.error("Synthetic mentor operation refused or failed.");process.exitCode=1;});