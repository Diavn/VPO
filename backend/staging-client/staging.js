"use strict";
const $=id=>document.getElementById(id);
let csrf="",busy=false;
async function api(path,method="GET",body){
 const headers={};if(method!=="GET"&&csrf)headers["X-CSRF-Token"]=csrf;
 if(body!==undefined)headers["Content-Type"]="application/json";
 const r=await fetch(path,{method,headers,credentials:"same-origin",cache:"no-store",body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok){const e=new Error("HTTP "+r.status);e.status=r.status;throw e;}return r.json();
}
function clear(){csrf="";$("profile").replaceChildren();$("orders").textContent="";$("results").textContent="";$("dashboard").hidden=true;$("login-panel").hidden=false;$("password").value="";}
function say(t){$("status").textContent=t;}
async function refresh(){
 const m=await api("/me");if(m.mode!=="synthetic-staging")throw Error("Invalid environment");csrf=m.csrf;
 const d=$("profile");d.replaceChildren();
 for(const [label,key] of [["Mã học sinh","student_code"],["Tên mẫu","name_vi"],["Khối","grade"],["Chương trình","curriculum"],["Ngôn ngữ","locale"]]){
  const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=String(m.profile[key]??"");d.append(dt,dd);
 }
 const [o,r]=await Promise.allSettled([api("/me/orders"),api("/me/results")]);
 if([o,r].some(x=>x.status==="rejected"&&x.reason.status===401))throw Object.assign(Error("Session expired"),{status:401});
 $("orders").textContent=o.status==="fulfilled"?JSON.stringify(o.value,null,2):"Không tải được dữ liệu mẫu.";
 $("results").textContent=r.status==="fulfilled"?JSON.stringify(r.value,null,2):"Không tải được dữ liệu mẫu.";
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