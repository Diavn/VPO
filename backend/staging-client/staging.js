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
 $("orders").textContent=o.status==="fulfilled"?JSON.stringify(o.value,null,2):"Không tải được dữ liệu mẫu.";
 $("results").textContent=r.status==="fulfilled"?JSON.stringify(r.value,null,2):"Không tải được dữ liệu mẫu.";
 const draw=(id,result,empty,render)=>{const root=$(id);root.replaceChildren();if(result.status!=="fulfilled"){root.textContent="Không tải được danh sách. Làm mới để thử lại.";return;}if(!result.value.data.length){root.textContent=empty;return;}for(const item of result.value.data)root.append(render(item));};
 const line=(title,detail,href,action)=>{const item=document.createElement("div"),h=document.createElement("p"),p=document.createElement("p");h.textContent=title;p.textContent=detail;item.append(h,p);if(href){const a=document.createElement("a");a.href=href;a.textContent=action;item.append(a);}return item;};
 const states={OPEN:"Có thể bắt đầu",UPCOMING:"Chưa mở",CLOSED:"Đã đóng",ACTIVE:"Đang làm bài",SUBMITTED:"Đã nộp",EXPIRED:"Hết giờ",AWAITING_SETTLEMENT:"Đang chốt bài"};
 draw("my-rounds",rounds,"Chưa có vòng thi được ghi danh.",v=>line(v.label,(states[v.availability]||v.availability)+" · "+new Date(v.opens_at).toLocaleString("vi-VN")+" – "+new Date(v.closes_at).toLocaleString("vi-VN"),["OPEN","ACTIVE","SUBMITTED","EXPIRED"].includes(v.availability)?"/exam-demo?round="+encodeURIComponent(v.id):null,"Mở vòng / xem biên nhận"));
 draw("my-courses",courses,"Chưa có khóa học được ghi danh.",v=>line(v.title,"Khóa học được ghi danh","/academy-demo?course="+encodeURIComponent(v.enrolment_id),"Mở khóa học"));
 $("dashboard").hidden=false;$("login-panel").hidden=true;say("Đã kết nối hồ sơ giả định.");
}
async function run(fn){if(busy)return;busy=true;for(const id of ["login","refresh","logout"])$(id).disabled=true;
 try{await fn();}catch(e){clear();say(e.status===401?"Phiên không hợp lệ hoặc hết hạn. Đăng nhập lại.":"Không hoàn tất yêu cầu. Kiểm tra kết nối và thử lại.");}
 finally{busy=false;for(const id of ["login","refresh","logout"])$(id).disabled=false;}
}
$("login-form").addEventListener("submit",e=>{e.preventDefault();run(async()=>{const email=$("email").value.trim(),password=$("password").value;if(!email.endsWith("@example.test")){say("Chỉ dùng email mẫu @example.test.");$("password").value="";return;}try{await api("/auth/login","POST",{email,password});}finally{$("password").value="";}await refresh();});});
$("refresh").addEventListener("click",()=>run(refresh));
$("logout").addEventListener("click",()=>run(async()=>{await api("/auth/logout","POST");clear();say("Đã đăng xuất phiên.");}));
window.addEventListener("pageshow",()=>run(refresh));