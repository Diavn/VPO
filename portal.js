"use strict";
// Synthetic state only. No requests, persistence, real user input or authorization.
const VPO_DEMO=(()=>{
 const ids=["profile","academic","achievements","evidence","honesty","rules","privacy"];
 const fresh=()=>({profile:false,academic:false,achievements:false,evidence:false,honesty:false,rules:false,privacy:false,verification:"draft",payment:"unpaid"});
 const percent=s=>Math.round(100*ids.filter(k=>s[k]).length/ids.length);
 const complete=s=>ids.every(k=>s[k]);
 const eligible=s=>complete(s)&&s.verification==="verified"&&["paid","waived"].includes(s.payment);
 const canSubmit=s=>complete(s)&&["draft","revision"].includes(s.verification);
 const canReport=s=>s.verification==="verified"&&s.payment==="unpaid";
 const scenarios=name=>{const s=fresh();if(name==="draft")return s;ids.forEach(k=>s[k]=true);if(name==="revision"){s.evidence=false;s.verification="revision";}else if(name==="submitted"){s.verification="submitted";}else if(["verified","paid","waived"].includes(name)){s.verification="verified";s.payment=name==="paid"?"paid":name==="waived"?"waived":"unpaid";}return s;};
 const edit=(s,key,value)=>{if(!ids.includes(key)||!["draft","revision"].includes(s.verification))return s;return {...s,[key]:Boolean(value)};};
 const submit=s=>canSubmit(s)?{...s,verification:"submitted"}:s;
 const report=s=>canReport(s)?{...s,payment:"reported"}:s;
 return {fresh,percent,complete,eligible,canSubmit,canReport,scenarios,edit,submit,report};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=VPO_DEMO;
if(typeof document!=="undefined"&&document.getElementById("portal")){
 const el=id=>document.getElementById(id);
 let s=VPO_DEMO.fresh();
 const tr=(v,e)=>document.documentElement.lang==="en"?e:v;
 const states={draft:["Bản nháp","Draft"],revision:["Cần bổ sung","Revision required"],submitted:["Chờ duyệt","Under review"],verified:["Đã duyệt mẫu","Verified (demo)"],unpaid:["Chưa thanh toán","Unpaid"],reported:["Đã báo · chưa đối soát","Reported · not reconciled"],paid:["Đã đối soát mẫu","Paid (demo)"],waived:["Miễn phí mẫu","Waived (demo)"]};
 const text=(id,v)=>{el(id).textContent=v;};
 function render(){
  const pct=VPO_DEMO.percent(s),editable=["draft","revision"].includes(s.verification),eligible=VPO_DEMO.eligible(s);
  text("profile-percent",pct+"%");el("profile-progress").value=pct;
  text("registration-metric",tr(...states[s.verification]));
  text("verification-state",tr(...states[s.verification]));
  text("payment-state",tr(...states[s.payment]));text("finance-state",tr(...states[s.payment]));
  text("eligibility-state",eligible?tr("Đủ điều kiện mẫu · không có phòng thi thật","Demo eligible · no real exam"):tr("Chưa đủ điều kiện mẫu","Demo not eligible"));
  text("registration-hint",VPO_DEMO.canSubmit(s)?tr("Có thể gửi hồ sơ mẫu.","Ready to submit the example."):!VPO_DEMO.complete(s)?tr("Hoàn thành các mục mẫu và cam kết trước.","Complete the sample sections and declarations first."):tr("Hồ sơ mẫu đã khóa hoặc đang chờ duyệt.","Example record is locked or under review."));
  for(const key of ["profile","academic","achievements","evidence"]){const b=el("complete-"+key);b.disabled=!editable||s[key];b.setAttribute("aria-pressed",String(s[key]));}
  for(const key of ["honesty","rules","privacy"]){el(key).checked=s[key];el(key).disabled=!editable;}
  el("submit-sample").disabled=!VPO_DEMO.canSubmit(s);el("report-payment").disabled=!VPO_DEMO.canReport(s);
 }
 function status(v,e){text("demo-status",tr(v,e));}
 for(const key of ["profile","academic","achievements","evidence"])el("complete-"+key).addEventListener("click",()=>{s=VPO_DEMO.edit(s,key,true);render();status("Đã cập nhật mục mẫu; không lưu dữ liệu thật.","Sample section updated; no real record saved.");});
 for(const key of ["honesty","rules","privacy"])el(key).addEventListener("change",e=>{s=VPO_DEMO.edit(s,key,e.target.checked);render();});
 el("submit-sample").addEventListener("click",()=>{s=VPO_DEMO.submit(s);render();status("Đã chuyển hồ sơ minh họa sang chờ duyệt. Không gửi máy chủ.","Sample moved to review. Nothing sent to a server.");});
 el("report-payment").addEventListener("click",()=>{s=VPO_DEMO.report(s);render();status("Mẫu: báo chuyển khoản, CHƯA xác nhận thanh toán.","Demo: transfer reported, NOT confirmed paid.");});
 el("scenario").disabled=false;el("demo-reset").disabled=false;
 el("scenario").addEventListener("change",e=>{s=VPO_DEMO.scenarios(e.target.value);render();status("Đang xem tình huống giả định.","Viewing a synthetic scenario.");});
 el("demo-reset").addEventListener("click",()=>{s=VPO_DEMO.fresh();el("scenario").value="draft";render();status("Đã đặt lại bản mẫu.","Demo reset.");});
 el("language")?.addEventListener("click",()=>{render();status("Đang xem bản mô phỏng; không có dữ liệu thật.","Demo only; no real records.");});
 render();
}