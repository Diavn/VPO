"use strict";const $=id=>document.getElementById(id);let token="",busy=false,pendingRound=null,contentEdit=null;
async function api(path,b){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(b),cache:"no-store",signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok)throw Object.assign(Error(j.error||"HTTP "+r.status),{status:r.status});return j;}
async function run(fn){if(busy)return;busy=true;document.querySelectorAll("button").forEach(b=>b.disabled=true);try{await fn();}catch(e){if(e.status===401&&token)clear();$("status").textContent="Không hoàn tất: "+e.message;}finally{busy=false;document.querySelectorAll("button").forEach(b=>b.disabled=false);}}
function clear(){token="";pendingRound=null;contentEdit=null;if($("workspace")){$("workspace").hidden=true;$("login").hidden=false;$("users").replaceChildren();$("invited").textContent="";$("password").value="";for(const id of ["overview","rounds","audit","content-list"])$(id)?.replaceChildren();$("enrol-round")?.replaceChildren(new Option("Chọn vòng thi",""));$("round-created").textContent="";$("round-topic").value="";$("round-label").value="DEMO ";$("round-open").value="";$("round-close").value="";$("content-title").value="";$("content-body").value="";$("content-status").textContent="";}if($("newpass")){$("newpass").value="";$("code").value="";}}
if(document.body.dataset.page==="admin"){
 function node(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
 function localTime(value){return new Date(value).toLocaleString("vi-VN",{timeZoneName:"short"});}
 async function dashboard(){
  const [summary,rounds,audit]=await Promise.all([api("/api/admin/overview",{}),api("/api/admin/rounds",{}),api("/api/admin/audit",{})]);
  const metrics=$("overview");metrics.replaceChildren();
  for(const [key,label] of [["users","Tài khoản chưa xóa"],["verified","Email đã xác thực"],["suspended","Đang khóa"],["rounds","Vòng thi"],["enrolments","Lượt ghi danh"],["active_attempts","Đang làm bài"],["submitted","Đã chốt bài"],["academy_enrolments","Lượt học Academy"]]){
   const item=node("div","","metric");item.append(node("strong",String(summary.data[key])),node("span",label));metrics.append(item);
  }
  const previous=$("enrol-round").value;const select=$("enrol-round");select.replaceChildren(new Option("Chọn vòng thi",""));
  $("rounds").replaceChildren();
  for(const r of rounds.data){
   const item=node("div","","round");item.append(node("p",r.label),node("p","UUID: "+r.id),node("p",localTime(r.opens_at)+" → "+localTime(r.closes_at)),node("p","Ghi danh: "+r.enrolments+" · Đang làm: "+r.active_attempts+" · Đã chốt: "+r.final_attempts));$("rounds").append(item);
   if(Date.parse(r.closes_at)>Date.now())select.add(new Option(r.label+" · "+r.id,r.id));
  }
  if([...select.options].some(o=>o.value===previous))select.value=previous;
  $("audit").replaceChildren();
  for(const event of audit.data)$("audit").append(node("div",localTime(event.created_at)+" · "+event.action+" · "+(event.email||"")+" "+(event.round_label||""),"audit-event"));
 }
 function newContent(){contentEdit=null;$("content-title").value="";$("content-body").value="";$("content-status").textContent="Bản nháp mới";}
 async function contentList(){
  const r=await api("/api/admin/content-list",{}),root=$("content-list");root.replaceChildren();
  for(const v of r.data){const a=node("article","");a.append(node("h3",v.title),node("p",v.category+" · "+v.state+" · #"+v.revision));
   if(v.state==="DRAFT"){const edit=node("button","Sửa bản nháp");edit.onclick=()=>{contentEdit={id:v.id,revision:v.revision};$("content-category").value=v.category;$("content-title").value=v.title;$("content-body").value=v.body;$("content-status").textContent="Đang sửa bản #"+v.revision;};a.append(edit);}
   if(v.state==="DRAFT"||v.state==="PUBLISHED"){const action=v.state==="DRAFT"?"publish":"withdraw",b=node("button",action==="publish"?"Công bố mẫu":"Gỡ công bố");b.onclick=()=>run(async()=>{if(!confirm("Xác nhận "+b.textContent+"?"))return;await api("/api/admin/content-transition",{id:v.id,revision:v.revision,action});if(contentEdit?.id===v.id)newContent();await contentList();});a.append(b);}
   root.append(a);
  }
 }
 $("content-new").onclick=()=>{if(confirm("Bỏ nội dung chưa lưu?"))newContent();};
 $("content-refresh").onclick=()=>run(contentList);
 $("content-save").onclick=()=>run(async()=>{if(!contentEdit)contentEdit={id:crypto.randomUUID(),revision:0};const b={...contentEdit,category:$("content-category").value,title:$("content-title").value.trim(),body:$("content-body").value.trim()};await api("/api/admin/content-save",b);contentEdit.revision++;$("content-status").textContent="Đã lưu bản nháp #"+contentEdit.revision;await contentList();});
 $("refresh-admin").onclick=()=>run(dashboard);
 $("create-round").onclick=()=>run(async()=>{
  const open=new Date($("round-open").value),close=new Date($("round-close").value);
  if(!Number.isFinite(open.getTime())||!Number.isFinite(close.getTime()))throw Error("Chọn giờ mở và đóng hợp lệ");
  const b={label:$("round-label").value.trim(),opens_at:open.toISOString(),closes_at:close.toISOString(),duration_seconds:Number($("round-duration").value),topic:$("round-topic").value.trim()};
  if(!confirm("Tạo vòng thi mẫu? Không thể sửa hoặc xóa vòng ở phiên bản này."))return;
  const encoded=JSON.stringify(b);
  if(pendingRound&&pendingRound.encoded!==encoded)throw Error("Có yêu cầu chưa xác nhận. Khôi phục nội dung cũ để gửi lại hoặc kiểm tra danh sách vòng thi trước khi tải lại trang.");
  if(!pendingRound)pendingRound={encoded,id:crypto.randomUUID()};
  let r;try{r=await api("/api/admin/round-create",{...b,op_id:pendingRound.id});}catch(err){if(err.status===422)pendingRound=null;throw err;}pendingRound=null;
  $("round-created").textContent="Đã tạo vòng: "+r.id;$("round-topic").value="";await dashboard();$("enrol-round").value=r.id;
 });
 async function list(){const r=await api("/api/admin/users",{search:$("search").value});$("users").replaceChildren();for(const u of r.data){const row=document.createElement("div");row.className="user";const label=document.createElement("p");label.textContent=u.email+" · "+u.status+" · "+(u.email_verified_at?"Email đã xác thực":"Tài khoản mẫu tạo bởi operator");row.append(label);if(u.status!=="DELETED")for(const [op,name] of [[u.status==="ACTIVE"?"suspend":"activate",u.status==="ACTIVE"?"Khóa":"Mở khóa"],["delete","Xóa user"]]){const b=document.createElement("button");b.textContent=name;if(op==="delete")b.className="delete";b.onclick=()=>run(async()=>{if(!confirm(name+" "+u.email+"?"))return;await api("/api/admin/change",{id:u.id,op});await list();await dashboard();$("status").textContent="Đã cập nhật.";});row.append(b);} if(u.status==="ACTIVE"&&u.email_verified_at){const b=node("button","Ghi danh");b.type="button";b.onclick=()=>run(async()=>{const round_id=$("enrol-round").value;if(!round_id)throw Error("Chọn vòng thi trước");if(!confirm("Ghi danh "+u.email+" vào vòng đã chọn?"))return;const r=await api("/api/admin/enrol",{user_id:u.id,round_id});await dashboard();$("status").textContent=r.result==="CREATED"?"Đã ghi danh.":"Đã ghi danh trước đó.";});row.append(b);} $("users").append(row);}}
 $("signin").onclick=()=>run(async()=>{try{const r=await api("/api/admin/login",{username:$("username").value,password:$("password").value});token=r.token;}finally{$("password").value="";}await list();await dashboard();$("workspace").hidden=false;$("login").hidden=true;$("status").textContent="Đã đăng nhập admin.";});
 $("find").onclick=()=>run(list);$("add").onclick=()=>run(async()=>{const r=await api("/api/admin/invite",{email:$("invite").value.trim().toLowerCase()});$("invited").textContent="Mã yêu cầu: "+r.challenge_id+" — kiểm tra hộp thư mẫu."});
 $("logout").onclick=()=>run(async()=>{try{await api("/api/admin/logout",{});}finally{clear();}$("status").textContent="Đã đăng xuất.";});
}else{
 const recovery=document.body.dataset.page==="reset",prefix=recovery?"/api/reset/":"/api/register/";
 $("request").onclick=()=>run(async()=>{const r=await api(prefix+"request",{email:$("email").value.trim().toLowerCase()});$("challenge").value=r.challenge_id;$("status").textContent="Nếu hợp lệ, mã đã được tạo trong hộp thư mẫu.";});
 $("verify").onclick=()=>run(async()=>{try{await api(prefix+"verify",{challenge_id:$("challenge").value.trim(),code:$("code").value.trim(),password:$("newpass").value});$("status").textContent=recovery?"Đã khôi phục mật khẩu mẫu. Đăng nhập lại bằng mật khẩu mới.":"Tài khoản mẫu đã kích hoạt. Đăng nhập tại Student Dashboard bằng email và mật khẩu vừa chọn.";}finally{$("newpass").value="";$("code").value="";}});
}window.addEventListener("pagehide",clear);