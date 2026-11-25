"use strict";
const el=id=>document.getElementById(id);
let csrf="",accountCode="",attempt=null,seq=0,acked="",pending=null,conflict=false,busy=false,deadlineMono=null,closed=false,authenticated=false,roundChecked=false,submitting=false;
const set=(id,v)=>{el(id).textContent=v;};
const bytes=s=>new TextEncoder().encode(s).length;
const dirty=()=>el("essay").value!==acked;
function controls(){el("login").disabled=busy;el("preflight").disabled=busy||!authenticated||!!attempt;el("round").disabled=busy||!!attempt;el("start").disabled=busy||!authenticated||!roundChecked||!!attempt;el("essay").disabled=!attempt||closed||conflict||!authenticated||submitting;el("save").disabled=busy||!attempt||closed||conflict||!authenticated||(!dirty()&&!pending);el("submit").disabled=busy||!attempt||closed||conflict||!authenticated;el("recover").disabled=busy||!attempt||!authenticated;el("receipt").disabled=busy||!attempt||!authenticated;}
async function api(path,method="GET",body){
 const headers={};if(body!==undefined)headers["Content-Type"]="application/json";if(method!=="GET"&&csrf)headers["X-CSRF-Token"]=csrf;
 const r=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(12000)});const data=await r.json();if(r.status===401){authenticated=false;controls();}return {status:r.status,data};
}
function expect(r,allowed=[200]){if(!allowed.includes(r.status))throw Error(r.data.error||("HTTP "+r.status));return r.data;}
function update(a){if(a.server_now&&a.deadline)deadlineMono=performance.now()+Math.max(0,Date.parse(a.deadline)-Date.parse(a.server_now));if(a.state){closed=a.state!=="ACTIVE";set("state",a.state);}if(a.latest_seq!==undefined)set("seq",String(a.latest_seq));controls();}
function count(){const s=el("essay").value.trim();set("count",(s?s.split(/\s+/u).length:0)+" từ · "+bytes(el("essay").value)+" byte");controls();}
function showReceipt(r){el("receipt-output").hidden=false;set("receipt-output",JSON.stringify(r,null,2));}
async function run(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){set("save-status","Chưa xác nhận: "+e.message+". Giữ trang mở và thử lại.");}finally{busy=false;controls();}}
async function recover(force=false){
 if((dirty()||pending)&&!force&&!confirm("Đọc lại sẽ thay thế phần chưa xác nhận. Hãy sao chép phần cần giữ trước. Tiếp tục?"))return;
 const d=expect(await api("/attempts/"+attempt+"/draft"));update(d);seq=d.draft.seq;acked=d.draft.body;pending=null;conflict=false;el("essay").value=acked;count();
 if(!closed){const t=expect(await api("/attempts/"+attempt+"/topics"));update(t);set("topic",t.topic);}else{set("topic","Phiên đã chốt.");}
 set("save-status","Đã đọc bản máy chủ #"+seq+".");
}
el("login").addEventListener("click",()=>run(async()=>{
 const email=el("email").value.trim();if(!/^[a-z0-9][a-z0-9._+-]*@example\.test$/.test(email))throw Error("Chỉ dùng tài khoản @example.test");
 const password=el("password").value;el("password").value="";
 const l=expect(await api("/auth/login","POST",{email,password}));csrf=l.csrf;
 const me=expect(await api("/me"));if(accountCode&&accountCode!==me.profile.student_code){authenticated=false;throw Error("Khác tài khoản; giữ phần chưa lưu, mở trang mới cho tài khoản khác");}
 csrf=me.csrf;accountCode=me.profile.student_code;authenticated=true;set("status","Đã xác thực tài khoản giả. "+accountCode);controls();
}));
el("round").addEventListener("input",()=>{roundChecked=false;controls();});
el("preflight").addEventListener("click",()=>run(async()=>{
 const id=el("round").value.trim();const r=expect(await api("/rounds/"+encodeURIComponent(id)+"/preflight"));roundChecked=r.may_start||!!r.attempt;set("status",r.label+" · "+(roundChecked?"Có thể mở phiên mẫu":"Chưa mở hoặc đã đóng"));}));
el("start").addEventListener("click",()=>run(async()=>{const r=expect(await api("/rounds/"+encodeURIComponent(el("round").value.trim())+"/attempts","POST"),[200,201]);attempt=r.id;conflict=true;update(r);await recover(true);}));
async function save(){
 if(!attempt||closed||conflict||!authenticated||(!dirty()&&!pending))return;
 if(!pending){const b=el("essay").value;if(bytes(b)>40000)throw Error("Bài vượt giới hạn 40.000 byte");pending={expected_seq:seq,op_id:crypto.randomUUID(),body:b};}
 const r=await api("/attempts/"+attempt+"/draft","PUT",pending);
 if(r.status===409){conflict=true;update(r.data);set("save-status","Xung đột phiên bản. Sao chép nội dung chưa lưu rồi đọc lại bản máy chủ.");return;}
 if(r.status===410){update(r.data);set("save-status","Phiên đã chốt; phần chưa xác nhận không được nộp.");if(r.data.receipt)showReceipt(r.data.receipt);return;}
 const d=expect(r);const sent=pending;pending=null;seq=d.ack_seq;acked=sent.body;update(d);
 if(d.latest_seq!==d.ack_seq){conflict=true;set("save-status","Một phiên khác đã lưu bản mới hơn; cần đối chiếu trước khi tiếp tục.");return;}
 set("save-status","Máy chủ xác nhận bản #"+seq+(dirty()?" · còn thay đổi chưa lưu":" · đã lưu"));
}
el("essay").addEventListener("input",count);
el("save").addEventListener("click",()=>run(save));
el("recover").addEventListener("click",()=>run(()=>recover(false)));
el("submit").addEventListener("click",()=>run(async()=>{
 if(!confirm("Nộp bài mẫu? Máy chủ sẽ chốt bản đã xác nhận."))return;
 submitting=true;controls();
 try{await save();if(dirty()||pending||conflict||closed){set("save-status","Không thể nộp thủ công: chưa đồng bộ hoặc đã hết giờ.");return;}const r=await api("/attempts/"+attempt+"/submit","POST",{expected_seq:seq});if(r.status===409){conflict=true;update(r.data);set("save-status","Xung đột bản lưu; kiểm tra lại.");return;}const d=expect(r,[200,201]);update(d);showReceipt(d.receipt);set("save-status","Đã chốt bản #"+d.receipt.seq+" · "+d.receipt.reason);}finally{submitting=false;controls();}
}));
el("receipt").addEventListener("click",()=>run(async()=>{const d=expect(await api("/attempts/"+attempt+"/receipt"));update(d);showReceipt(d.receipt);}));
setInterval(()=>{if(!busy&&attempt&&!closed&&authenticated&&!conflict&&(dirty()||pending))run(save);},8000);
setInterval(()=>{if(deadlineMono===null)return;const n=Math.max(0,Math.ceil((deadlineMono-performance.now())/1000));set("time",String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0"));if(n===0&&!busy&&attempt&&!closed&&authenticated)run(async()=>{const d=expect(await api("/attempts/"+attempt));update(d);if(closed){const r=expect(await api("/attempts/"+attempt+"/receipt"));showReceipt(r.receipt);set("save-status","Hết giờ. Máy chủ chốt bản đã xác nhận cuối cùng.");}});},1000);
function event(kind){if(!attempt||closed||!authenticated)return;api("/attempts/"+attempt+"/events","POST",{event_id:crypto.randomUUID(),kind}).catch(()=>{});}
document.addEventListener("visibilitychange",()=>event(document.hidden?"HIDDEN":"VISIBLE"));
window.addEventListener("online",()=>{event("RECONNECTED");if(!busy&&!conflict&&!closed&&(pending||dirty()))run(save);});
window.addEventListener("offline",()=>set("save-status","Mất mạng. Không đóng trang; phần chưa xác nhận chưa được lưu."));
window.addEventListener("beforeunload",e=>{if(dirty()||pending){e.preventDefault();e.returnValue="";}});
controls();