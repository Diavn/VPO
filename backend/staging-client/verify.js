"use strict";
const $=id=>document.getElementById(id);
let busy=false,generation=0;
function clearSlip(){$("slip").hidden=true;$("slip").removeAttribute("href");}
function readScan(){
 const scanned=location.hash.slice(1);if(!scanned)return;
 history.replaceState(null,"",location.pathname+location.search);
 generation++;clearSlip();$("verification").hidden=true;$("verification-data").replaceChildren();
 $("token").value=/^[a-f0-9]{64}$/.test(scanned)?scanned:"";
 $("verify-status").textContent=$("token").value?"Mã QR đã nhập. Bấm kiểm tra trạng thái.":"Mã xác minh mẫu không hợp lệ.";
}
window.addEventListener("hashchange",readScan);readScan();
$("verify-form").addEventListener("submit",async e=>{
 e.preventDefault();if(busy)return;const token=$("token").value.trim();
 clearSlip();$("verification").hidden=true;$("verification-data").replaceChildren();
 if(!/^[a-f0-9]{64}$/.test(token)){$("verify-status").textContent="Mã xác minh mẫu không hợp lệ.";return;}
 busy=true;const attempt=++generation;$("verify").disabled=true;$("verify-status").textContent="Đang kiểm tra...";
 try{
  const r=await fetch("/public/certificates/"+token,{cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(10000)});
  if(attempt!==generation)return;
  if(r.status===404){$("verify-status").textContent="Không tìm thấy chứng nhận mẫu.";return;}
  if(!r.ok)throw Error("Request failed");
  const v=await r.json(),states={VALID_DEMO:"Hợp lệ trong mô phỏng",ON_HOLD:"Đang tạm giữ",REVOKED:"Đã thu hồi"};
  if(attempt!==generation)return;
  if(v.mode!=="synthetic"||!Object.hasOwn(states,v.status))throw Error("Invalid response");
  const awards={NONE:"Không có giải",FIRST:"Giải Nhất",SECOND:"Giải Nhì",THIRD:"Giải Ba",HONORABLE_MENTION:"Khuyến khích"};
  const add=(key,value)=>{const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=key;dd.textContent=value;$("verification-data").append(dt,dd);};
  add("Trạng thái",states[v.status]);if(v.status==="VALID_DEMO"&&v.award)add("Giải mẫu",awards[v.award]||v.award);add("Thời điểm cấp",new Date(v.issued_at).toLocaleString("vi-VN"));
  if(v.status==="VALID_DEMO"){$("slip").href="/public/certificates/"+token+"/document.pdf";$("slip").hidden=false;}
  $("verification").hidden=false;$("verify-status").textContent="Đã kiểm tra trạng thái mẫu.";
 }catch{if(attempt===generation)$("verify-status").textContent="Không xác minh được. Làm mới để thử lại.";}
 finally{if(attempt===generation)$("token").value="";busy=false;$("verify").disabled=false;}
});
window.addEventListener("pagehide",()=>{generation++;clearSlip();$("token").value="";$("verification").hidden=true;$("verification-data").replaceChildren();$("verify-status").textContent="";});