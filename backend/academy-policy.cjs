"use strict";
const P=require("./exam-policy.cjs"),W=require("./workflow-policy.cjs");
const exact=(x,k)=>x&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).sort().join(",")===k;
const stage=x=>["BASELINE","REVISION","TRANSFER"].includes(x);
const validText=(x,n,allowEmpty=false)=>typeof x==="string"&&Buffer.byteLength(x,"utf8")<=n&&(allowEmpty||x.trim().length>0)&&!x.includes("\u0000")&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x);
const validCompletion=b=>exact(b,"ordinal")&&Number.isInteger(b.ordinal)&&b.ordinal>=1&&b.ordinal<=6;
function validSubmission(b){
 if(!exact(b,"condition,essay,op_id,revision_note,stage")||!stage(b.stage)||!P.uuid(b.op_id)||!validText(b.essay,40000)||!validText(b.revision_note,2000,true))return false;
 if(b.stage==="REVISION")return ["FEEDBACK_SUPPORTED","OTHER_DECLARED"].includes(b.condition)&&b.revision_note.trim().length>0;
 return ["INDEPENDENT_DECLARED","OTHER_DECLARED"].includes(b.condition)&&b.revision_note==="";
}
const validFeedback=b=>exact(b,"evidence,next_action,scores")&&W.scores(b.scores)&&validText(b.evidence,2000)&&validText(b.next_action,2000);
function analytics(record){
 const lessons=Array.isArray(record.lessons)?record.lessons:[], submissions=Array.isArray(record.submissions)?record.submissions:[];
 const item=stage=>submissions.find(x=>x.stage===stage);
 const score=x=>x&&W.scores(x.scores)?x.scores.reduce((a,b)=>a+b,0):null;
 const baseline=item("BASELINE"),revision=item("REVISION"),transfer=item("TRANSFER");
 const bs=score(baseline),rs=score(revision),ts=score(transfer);
 const pair=baseline?.condition==="INDEPENDENT_DECLARED"&&transfer?.condition==="INDEPENDENT_DECLARED"&&bs!==null&&ts!==null;
 return {completed_lessons:lessons.filter(x=>x.completed===true).length,total_lessons:lessons.length,submitted_tasks:submissions.length,assessed_tasks:submissions.filter(x=>score(x)!==null).length,baseline_score:bs,revision_score:rs,transfer_score:ts,revision_difference:bs!==null&&rs!==null?rs-bs:null,declared_independent_transfer_difference:pair?ts-bs:null,interpretation:"Descriptive scores only; conditions are self-declared, tasks are not equated, no causal or competence claim."};
}
module.exports={validCompletion,validSubmission,validFeedback,analytics};