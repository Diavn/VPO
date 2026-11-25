"use strict";
const $=id=>document.getElementById(id);
let csrf="",busy=false;
async function api(path,method="GET",body){
 const headers={};if(method!=="GET"&&csrf)headers["X-CSRF-Token"]=csrf;
 if(body!==undefined)headers["Content-Type"]="application/json";
 const r=await fetch(path,{method,headers,credentials:"same-origin",cache:"no-store",body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok){const e=new Error("HTTP "+r.status);e.status=r.status;throw e;}return r.json();
}
function clear(){csrf="";$("profile").replaceChildren();$("my-rounds").replaceChildren();$("my-courses").replaceChildren();$("orders").textContent="";$("results").textContent="";$("dashboard").hidden=true;$("login-panel").hidden=false;$("password").value="";}
function say(t){$("status").textContent=t;}
async function refresh(){
 const m=await api("/me");if(m.mode!=="synthetic-staging")throw Error("Invalid environment");csrf=m.csrf;
 const d=$("profile");d.replaceChildren();
 for(const [label,key] of [["Mã học sinh","student_code"],["Tên mẫu","name_vi"],["Khối","grade"],["Chương trình","curriculum"],["Ngôn ngữ","locale"]]){
  const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=String(m.profile[key]??"");d.append(dt,dd);
 }
 const [o,r,rounds,courses]=await Promise.allSettled([api("/me/orders"),api("/me/results"),api("/me/rounds"),api("/me/academy")]);
 if([o,r,rounds,courses].some(x=>x.status==="rejected"&&x.reason.status===401))throw Object.assign(Error("Session expired"),{status:401});
 const draw=(id,result,empty,render)=>{const root=$(id);root.replaceChildren();if(result.status!=="fulfilled"){root.textContent="Không tải được danh sách. Làm mới để thử lại.";return;}if(!result.value.data.length){root.textContent=empty;return;}for(const item of result.value.data)root.append(render(item));};
 const line=(title,detail,href,action)=>{const item=document.createElement("div"),h=document.createElement("p"),p=document.createElement("p");h.textContent=title;p.textContent=detail;item.append(h,p);if(href){const a=document.createElement("a");a.href=href;a.textContent=action;item.append(a);}return item;};
 const states={OPEN:"Có thể bắt đầu",UPCOMING:"Chưa mở",CLOSED:"Đã đóng",ACTIVE:"Đang làm bài",SUBMITTED:"Đã nộp",EXPIRED:"Hết giờ",AWAITING_SETTLEMENT:"Đang chốt bài"};
 draw("my-rounds",rounds,"Chưa có vòng thi được ghi danh.",v=>line(v.label,(states[v.availability]||v.availability)+" · "+new Date(v.opens_at).toLocaleString("vi-VN")+" – "+new Date(v.closes_at).toLocaleString("vi-VN"),["OPEN","ACTIVE","SUBMITTED","EXPIRED"].includes(v.availability)?"/exam-demo?round="+encodeURIComponent(v.id):null,"Mở vòng / xem biên nhận"));
 draw("my-courses",courses,"Chưa có khóa học được ghi danh.",v=>line(v.title,"Khóa học được ghi danh","/academy-demo?course="+encodeURIComponent(v.enrolment_id),"Mở khóa học"));
 const txt=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
 const payStates={UNPAID:"Chưa báo chuyển khoản",REPORTED:"Chờ đối soát",PAID:"Đã đối soát"};
 const award={NONE:"Không có giải",FIRST:"Giải Nhất",SECOND:"Giải Nhì",THIRD:"Giải Ba",HONORABLE_MENTION:"Khuyến khích"};
 const appeals={OPEN:"Đang xem xét",DISMISSED:"Không chấp nhận",REVIEW_REQUIRED:"Cần xem xét lại"};
 draw("orders",o,"Chưa có đơn phí mẫu.",v=>{
  const card=document.createElement("div");card.className="record";
  card.append(txt("h4","Đơn phí mẫu"),txt("p","Mã: "+v.id),txt("p",String(v.amount_units)+" đơn vị giả định"),txt("p",payStates[v.state]||v.state));
  if(v.state==="UNPAID"){
   const label=txt("label","Mã giao dịch mẫu (DEMO-...)"),input=document.createElement("input");input.id="ref-"+v.id;input.maxLength=37;input.autocomplete="off";label.htmlFor=input.id;
   const button=txt("button","Báo giao dịch mẫu");button.type="button";
   button.onclick=()=>run(async()=>{const ref=input.value.trim();if(!/^DEMO-[A-Z0-9]{8,32}$/.test(ref)){say("Mã giao dịch mẫu không hợp lệ.");return;}if(!confirm("Gửi báo giao dịch mẫu? Không phải chuyển tiền thật."))return;await api("/me/orders/"+v.id+"/report","POST",{transfer_ref:ref});await refresh();say("Đã gửi báo giao dịch mẫu; chờ đối soát.");});
   card.append(label,input,button);
  }return card;
 });
 draw("results",r,"Chưa có kết quả mẫu được công bố.",v=>{
  const card=document.createElement("div");card.className="record";card.append(txt("h4","Kết quả mẫu: "+String(v.score)+"/20"),txt("p",award[v.award]||v.award),txt("p","Rubric: "+v.rubric_version),txt("p","Công bố: "+new Date(v.published_at).toLocaleString("vi-VN")),txt("p","Mã hồ sơ: "+v.case_id));
  if(v.appeal_state){card.append(txt("p","Phúc khảo: "+(appeals[v.appeal_state]||v.appeal_state)));}
  else{const label=txt("label","Loại phúc khảo mẫu"),select=document.createElement("select");select.id="appeal-"+v.case_id;label.htmlFor=select.id;
   for(const [key,name] of [["SCORING","Chấm điểm"],["PROCESS","Quy trình"],["TECHNICAL","Kỹ thuật"]])select.add(new Option(name,key));
   const button=txt("button","Gửi phúc khảo mẫu");button.type="button";button.onclick=()=>run(async()=>{if(!confirm("Gửi một yêu cầu phúc khảo mẫu?"))return;await api("/me/results/"+v.case_id+"/appeal","POST",{category:select.value});await refresh();say("Đã gửi phúc khảo mẫu.");});card.append(label,select,button);
  }return card;
 });
 $("dashboard").hidden=false;$("login-panel").hidden=true;say("Đã kết nối hồ sơ giả định.");
}
async function run(fn){if(busy)return;busy=true;for(const id of ["login","refresh","logout"])$(id).disabled=true;
 try{await fn();}catch(e){if(e.status===401||$("dashboard").hidden)clear();say(e.status===401?"Phiên không hợp lệ hoặc hết hạn. Đăng nhập lại.":"Không xác nhận được yêu cầu. Làm mới để kiểm tra trạng thái trước khi gửi lại.");}
 finally{busy=false;for(const id of ["login","refresh","logout"])$(id).disabled=false;}
}
$("login-form").addEventListener("submit",e=>{e.preventDefault();run(async()=>{const email=$("email").value.trim(),password=$("password").value;if(!email.endsWith("@example.test")){say("Chỉ dùng email mẫu @example.test.");$("password").value="";return;}try{await api("/auth/login","POST",{email,password});}finally{$("password").value="";}await refresh();});});
$("refresh").addEventListener("click",()=>run(refresh));
$("logout").addEventListener("click",()=>run(async()=>{await api("/auth/logout","POST");clear();say("Đã đăng xuất phiên.");}));
window.addEventListener("pageshow",()=>run(refresh));