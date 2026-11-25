"use strict";
// Local staff tool. DB enforces real role/assignment scope via session_user; no web staff login.
const {Client}=require("pg"),W=require("./workflow-policy.cjs");
async function main(){
 if(process.env.VPO_MODE!=="synthetic-staging"||!process.env.DATABASE_URL)throw Error("Synthetic staging only");
 const [op,raw,...extra]=process.argv.slice(2);if(extra.length)throw Error("Usage: node workflow-cli.cjs OP [UUID]");
 const obj=raw||null;
 let input="";for await(const chunk of process.stdin){input+=chunk.toString();if(Buffer.byteLength(input)>8192)throw Error("Input too large");}
 const b=input.trim()?JSON.parse(input):{};if(!W.validateStaff(op,obj,b))throw Error("Invalid operation or input");
 const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:10000,query_timeout:12000});
 try{await db.connect();const r=await db.query("SELECT vpo_stage.demo_staff_action($1,$2::uuid,$3::jsonb) AS value",[op,obj,JSON.stringify(b)]);console.log(JSON.stringify(r.rows[0].value,null,2));}finally{await db.end().catch(()=>{});}
}
main().catch(e=>{console.error("Synthetic staff operation refused or failed. Do not log secrets or real data.");process.exitCode=1;});