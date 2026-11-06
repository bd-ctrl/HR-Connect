// Live score data only. Drafts remain local; a successful submission requires a Base receipt.
(function(root){
 let state={status:'idle',data:null,error:'',code:''},generation=0,sequence=0,sending=false,refreshing=false,confirmedHistory=[],hooks={};
 const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const active=()=>root.GlowLogin.active(),admin=()=>root.GlowLogin.profile()?.role==='admin';
 const emit=()=>hooks.render?.();
 const numeric=v=>v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=1&&v<=5);
 const validSummary=r=>r&&numeric(r.overall)&&Array.isArray(r.dims)&&r.dims.length===3&&r.dims.every(d=>numeric(d.mean));
 const validHistory=h=>h&&typeof h.target==='string'&&typeof h.name==='string'&&typeof h.department==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(h.round)&&Number.isFinite(Date.parse(h.created));
 const validFeedback=f=>f&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(f.round)&&Number.isFinite(Date.parse(f.created))&&Array.isArray(f.answers)&&f.answers.length>0&&f.answers.length<=3&&new Set(f.answers.map(a=>a.dimension)).size===f.answers.length&&f.answers.every(a=>['ความเร็ว','ความถูกต้อง','การสื่อสาร'].includes(a.dimension)&&Number.isInteger(a.score)&&a.score>=1&&a.score<=5);
 function history(){
  if(!active())return [];
  return [...new Map([...(state.data?.history||[]),...confirmedHistory].map(h=>[h.round+'|'+h.target,h])).values()];
 }
 function reset(){generation++;sequence++;state={status:'idle',data:null,error:'',code:''};sending=false;refreshing=false;confirmedHistory=[];}
 function ready(){return state.status==='ready'&&!state.data.setup_required&&state.data.storage_private!==false;}
 function round(){return state.data?.round||'2026-10';}
 function dateLabel(value){return new Date(value).toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric'});}
 function monthLabel(value){return new Date(value+'-01T12:00:00Z').toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',month:'short',year:'numeric'});}
 function greeting(){
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  const text=hour<5||hour>=23?'ยังไม่นอนอีกเหรอ':hour<11?'อรุณสวัสดิ์':hour<14?'สวัสดีตอนเที่ยง':hour<17?'สวัสดีตอนบ่าย':hour<18?'สวัสดีตอนเย็น':hour<20?'ได้เวลาเลิกงานแล้ว กลับบ้านกัน':'วันนี้เหนื่อยไหม';
  const nickname=String(root.GlowLogin.profile()?.nickname||'').trim();
  return e(text+(nickname?' '+nickname:''));
 }
 async function load({quiet=false}={}){
  if(!active()||(quiet&&refreshing))return;
  const g=generation,s=++sequence,background=quiet&&state.status==='ready';refreshing=true;
  if(!background){state={...state,status:'loading',error:'',code:''};emit();}
  try{
   const data=await root.GlowLogin.request(admin()?'/hr/state':'/me/state');
   if(g!==generation||s!==sequence||!active())return;
   if(typeof data.round!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(data.round)||!data.policy||!Number.isInteger(data.policy.minimum_raters))throw Error('ข้อมูลรอบประเมินไม่ถูกต้อง');
   if(admin()){
    if(!Array.isArray(data.reviews)||data.reviews.some(r=>typeof r.record_id!=='string'||!Number.isInteger(r.score)||r.score<1||r.score>3||typeof r.reason!=='string')||typeof data.setup_required!=='boolean'||typeof data.storage_private!=='boolean')throw Error('ข้อมูล HR ไม่ถูกต้อง');
   }else if(!Array.isArray(data.history)||data.history.some(h=>!validHistory(h))||(data.feedback!==undefined&&(!Array.isArray(data.feedback)||data.feedback.some(f=>!validFeedback(f))))||!Array.isArray(data.notifications)||data.notifications.some(n=>!Number.isInteger(n.count)||n.count<1||!Number.isFinite(Date.parse(n.created)))||!validSummary(data.summary)||!validSummary(data.previous)||!Number.isInteger(data.summary.received)||data.summary.received<0)throw Error('ข้อมูลคะแนนไม่ถูกต้อง');
   state={status:'ready',data,error:'',code:''};hooks.data?.(data);
  }catch(error){if(g!==generation||s!==sequence||!active())return;state={...state,status:background?'ready':'error',error:error.message||'โหลดคะแนนไม่สำเร็จ',code:error.code||'score_error'};}
  finally{if(g===generation&&s===sequence)refreshing=false;}
  emit();
 }
 function notice(){
  if(state.status==='idle'||state.status==='loading')return '<p class="muted" role="status">กำลังโหลดคะแนน…</p>';
  if(state.status==='error'){
   if(admin())return '<div class="error" role="alert">'+e(state.error)+'</div><button class="secondary" data-score-reload type="button">ตรวจการเชื่อมต่ออีกครั้ง</button>';
   return '';
  }
  return '';
 }
 async function submit(body){
  if(sending)throw Error('กำลังส่งการประเมิน กรุณารอสักครู่');
  const g=generation;sending=true;
  try{
   if(!ready())await load();
   if(g!==generation||!active())throw Object.assign(Error('บัญชีที่ใช้งานเปลี่ยนแล้ว'),{code:'session_changed'});
   if(!ready())throw Object.assign(Error('ยังส่งไม่สำเร็จ กรุณาลองอีกครั้ง'),{code:state.code||'score_unavailable'});
   const receipt=await root.GlowLogin.request('/assessments',{method:'POST',body});
   if(g!==generation||!active())throw Object.assign(Error('บัญชีที่ใช้งานเปลี่ยนแล้ว'),{code:'session_changed'});
   if(receipt.persisted!==true||receipt.answers!==3||typeof receipt.assessment_id!=='string')throw Error('ยังยืนยันการบันทึกครบ 3 ด้านไม่ได้ กรุณาลองส่งอีกครั้ง');
   // Keep only server-confirmed history in this account's memory if the next
   // read fails. Never manufacture a sent entry from a draft or request body.
   const entry=receipt.history_entry;
   if(validHistory(entry)&&entry.target===body.target_id&&entry.round===body.round)confirmedHistory.push(entry);
   await load();return receipt;
  }catch(error){
   if(['score_setup_required','score_field_type','score_configuration_missing','score_storage_not_private','score_api_missing','configuration_missing','invalid_score_configuration'].includes(error.code))throw Object.assign(Error('ยังส่งไม่สำเร็จ กรุณาลองอีกครั้ง'),{code:error.code});
   throw error;
  }finally{if(g===generation)sending=false;}
 }
 function setupNotice(){
  if(state.status!=='ready')return notice();
  const d=state.data,missing=Array.isArray(d.missing)?d.missing:[],invalid=Array.isArray(d.invalid_fields)?d.invalid_fields:[];let out='';
  if(!d.storage_private)out+='<div class="error">ก่อนเก็บคะแนนจริง ให้จำกัดลิงก์ Base เป็นเฉพาะผู้มีสิทธิ์ แล้วตั้ง SCORE_STORAGE_PRIVATE เป็น true ใน Worker ระบบจะยังไม่รับผลประเมินจนกว่าจะตั้งค่านี้</div>';
  if(d.setup_required)out+='<section class="card"><h2>ตั้งค่าการบันทึกคะแนนครั้งแรก</h2><p class="muted">ผู้ดูแลทำครั้งเดียวเมื่อติดตั้งระบบ พนักงานเริ่มส่งได้เมื่อการตั้งค่าครบ</p>'+(d.score_table_id?'<p>ตารางที่เชื่อมอยู่: <code>'+e(d.score_table_id)+'</code></p>':'')+(missing.length?'<h3>คอลัมน์ที่ยังขาด ('+missing.length+')</h3><ul>'+missing.map(name=>'<li>'+e(name)+'</li>').join('')+'</ul>':'')+(invalid.length?'<div class="error"><p>คอลัมน์ที่มีอยู่แต่ชนิดข้อมูลไม่รองรับ</p><ul>'+invalid.map(name=>'<li>'+e(name)+'</li>').join('')+'</ul><p>ให้ผู้ดูแลเทียบกับตารางเดิมก่อนดำเนินการ ระบบจะยังไม่เพิ่มคอลัมน์หรือเปลี่ยนข้อมูล</p></div>':'<p class="muted">ปุ่มนี้เพิ่มเฉพาะคอลัมน์ที่ขาด เก็บคอลัมน์และข้อมูลเดิมไว้</p><button class="primary" id="setup-live-scores" type="button">เตรียมตารางคะแนน</button>')+'</section>';
  return out;
 }
 function feedbackView(){
  if(state.status!=='ready'||!Array.isArray(state.data?.feedback))return '';
  const items=state.data.feedback.filter(f=>f.round===round());
  return '<section class="card received-feedback"><div class="row"><h2>ฟีดแบ็กที่ได้รับ</h2><span class="pill">'+e(monthLabel(round()))+'</span></div><p class="muted">คะแนน 4–5 ดาวแสดงหลังบันทึกสำเร็จทันที · ไม่แสดงชื่อผู้ประเมิน</p>'+(items.length?'<div class="received-feedback-list">'+items.map(f=>'<article class="received-feedback-item"><p class="muted">'+e(dateLabel(f.created))+'</p><div class="received-feedback-scores">'+f.answers.map(a=>'<div><span>'+e(a.dimension)+'</span><strong><span aria-hidden="true">★</span> '+a.score+' / 5</strong></div>').join('')+'</div></article>').join('')+'</div>':'<p class="feedback-empty">เมื่อมีคะแนนที่แสดงได้ คุณจะเห็นรายการที่นี่</p>')+'</section>';
 }
 function home(ui){
  if(admin())return hrHome(ui);
  const d=state.data,r=d?.summary,p=d?.previous,usable=state.status==='ready',score=usable?r.overall:null;
  const empty=!usable?'รอแสดงผลประเมิน':r.state==='no_evaluations'?'ยังไม่ได้รับการประเมิน':r.state==='insufficient_data'?'ได้รับการประเมินแล้ว · รอข้อมูลครบเกณฑ์':'รอ HR ตรวจสอบ';
  const detail=!usable?'':r.state==='no_evaluations'?'เมื่อมีผลประเมินที่ผ่านเกณฑ์ คะแนนเฉลี่ยจะแสดงที่นี่':r.state==='insufficient_data'?'คะแนนแต่ละด้านต้องมีผู้ประเมินอย่างน้อย '+(r.minimum_raters||d.policy.minimum_raters)+' คน':'คะแนนที่ผ่านการตรวจสอบและครบเกณฑ์จะนำมาคำนวณ';
  const comparison=(label,value)=>'<div class="comparison-row"><div class="row"><span>'+e(label)+'</span><strong>'+(value===null?'—':Number(value).toFixed(1)+' / 5')+'</strong></div><div class="bar"><span style="width:'+(value===null?0:Number(value)/5*100)+'%"></span></div></div>';
  const delta=score!==null&&p?.overall!==null&&p?.overall!==undefined?score-p.overall:null;
  return ui.head(greeting(),'ทุกความคิดเห็น ช่วยให้เราเติบโตไปด้วยกัน','',false)+feedbackView()+'<div class="employee-home-layout"><section class="card score-home-card score-home-card-featured"><div class="row"><div><p class="eyebrow">คะแนนที่ผ่านเกณฑ์และการตรวจสอบ</p><h2>คะแนนเฉลี่ยของฉัน</h2></div>'+ui.mascot(score===null?3:Math.round(score)).replace('mascot-aura ','mascot-aura score-home-mascot ')+'</div>'+notice()+(score===null?'<div class="score-pending"><strong>'+e(empty)+'</strong><p class="muted">'+e(detail)+'</p></div>':'<div class="score-home-value">'+score.toFixed(1)+'<span> / 5</span></div><p class="muted">ค่าเฉลี่ยจากผู้ประเมินที่ไม่ระบุตัวตน</p>')+(usable&&r.received?ui.bars(r):'')+'</section><div class="employee-home-support"><section class="card hero"><div class="copy"><div class="eyebrow">CUBIC CONNECT · PEOPLE & CULTURE</div><h2><span class="hero-line-one">ฟังกันมากขึ้น</span><br><span class="hero-line-two">เข้าใจกันมากขึ้น</span></h2><p class="muted">ประเมินคนที่ได้ร่วมงานจริง<br>เลือกแผนก ผู้ร่วมงาน และโปรเจกต์ในขั้นตอนถัดไป</p><button class="primary" data-nav="rate" '+(d?.round_state&&d.round_state!=='open'?'disabled':'')+'>เริ่มประเมินผู้ร่วมงาน</button></div>'+ui.mascot(4,'mascot')+'</section><section class="card month-comparison"><div class="row"><h2>เทียบกับเดือนก่อน</h2><span class="pill">'+e(monthLabel(round()))+'</span></div><div class="comparison-chart">'+comparison(p?monthLabel(p.round):'เดือนก่อน',usable?p.overall:null)+comparison(monthLabel(round()),score)+'</div><p class="comparison-delta">'+(delta===null?'แสดงแนวโน้มเมื่อทั้งสองเดือนมีคะแนนครบเกณฑ์':delta>0?'เพิ่มขึ้น '+delta.toFixed(1)+' คะแนน':delta<0?'ลดลง '+Math.abs(delta).toFixed(1)+' คะแนน':'เท่ากับเดือนก่อน')+'</p></section></div></div>';
 }
 function hrHome(ui){
  const pending=(state.data?.reviews||[]).filter(r=>r.status==='รอ HR ตรวจสอบ').length;
  return ui.head(greeting(),'ตรวจสอบผลประเมินจาก Base','',false)+setupNotice()+(ready()?'<div class="stats"><section class="card"><p class="muted">รอตรวจสอบ</p><div class="num">'+pending+'</div><p class="muted">คะแนนรายด้าน</p></section><section class="card"><p class="muted">รอบประเมิน</p><h2>'+e(monthLabel(round()))+'</h2></section></div><section class="card"><h2>ผลประเมินที่ต้องตรวจสอบ</h2><p class="muted">คะแนน 1–3 ดาวจะนำมาคำนวณหลังอนุมัติ ส่วนคะแนน 4–5 ดาวผ่านอัตโนมัติ โดยยังใช้เกณฑ์จำนวนผู้ประเมินรายด้าน</p><button class="primary" data-nav="queue">เปิดคิวตรวจสอบ</button></section>':'');
 }
 function hrView(page,ui){
  if(page==='home')return hrHome(ui);
  if(page==='admin')return ui.head('ตั้งค่าระบบคะแนน','ใช้ตารางคะแนนใน Base HR Connect','',false)+setupNotice()+(ready()?'<section class="card"><h2>เชื่อมตารางคะแนนแล้ว</h2><p>รอบ '+e(monthLabel(round()))+' · ขั้นต่ำ '+state.data.policy.minimum_raters+' ผู้ประเมินต่อด้าน</p><p class="muted">รอบและสถานะรับประเมินกำหนดผ่าน EVALUATION_ROUND และ ROUND_STATE ใน Worker</p><button class="secondary" data-score-reload>ตรวจการเชื่อมต่ออีกครั้ง</button></section>':'');
  if(page!=='queue')return ui.head('รายงานรวม','ข้อมูลรายงานส่วนนี้ยังไม่ได้เชื่อมกับ Base','',false)+'<section class="card"><p class="muted">ใช้คิวตรวจสอบเพื่อตรวจผลประเมินจริงที่บันทึกใน Base ได้</p><button class="primary" data-nav="queue">ไปคิวตรวจสอบ</button></section>';
  const rows=state.data?.reviews||[];
  return ui.head('คิวตรวจสอบข้อเท็จจริง','คะแนน 1–3 ดาว · เฉพาะ HR','',false)+setupNotice()+(ready()?'<section class="card"><button class="secondary" data-score-reload>โหลดรายการล่าสุด</button>'+rows.map(r=>'<article class="review-case"><div class="row"><div><p class="eyebrow">'+e(r.dimension)+'</p><h3>'+e(r.name)+' · '+e(r.department)+'</h3></div><span class="pill rose">'+r.score+' / 5</span></div><p class="muted">'+e(dateLabel(r.created))+'</p><blockquote>'+e(r.reason)+'</blockquote>'+(r.context?'<p class="muted">โปรเจกต์: '+e(r.context)+'</p>':'')+'<p>'+e(r.status)+'</p>'+(r.status==='รอ HR ตรวจสอบ'?'<div class="btn-group"><button class="secondary" data-live-review="'+e(r.record_id)+'" data-decision="approved">Approve</button><button class="danger" data-live-review="'+e(r.record_id)+'" data-decision="rejected">Reject</button></div>':'<p class="muted">'+e(r.note)+'</p>')+'</article>').join('')+(!rows.length?'<div class="empty"><h3>ไม่มีคะแนนที่ต้องตรวจสอบ</h3></div>':'')+'</section>':'');
 }
 async function openNotifications(ui){
  await load();if(!active())return;
  const rows=state.status==='ready'?state.data?.notifications||[]:[],grouped={};
  for(const r of rows){const date=dateLabel(r.created);grouped[date]=(grouped[date]||0)+r.count;}
  const total=rows.reduce((sum,r)=>sum+r.count,0);
  const body=state.status==='error'?'<p class="muted">'+e(admin()?state.error:'การแจ้งเตือนจะแสดงที่นี่เมื่อพร้อม')+'</p>':total?'<p class="muted">มีฟีดแบ็กเข้ามาใน 30 วันล่าสุด '+total+' รายการ โดยไม่แสดงชื่อผู้ประเมิน</p>'+Object.entries(grouped).map(([day,count])=>'<div class="notification-item"><span>'+e(day)+'</span><strong>'+count+' รายการ</strong></div>').join(''):'<p class="muted">ยังไม่มีฟีดแบ็กใหม่ในช่วง 30 วันที่ผ่านมา</p>';
  if(state.status==='ready')try{localStorage.setItem(ui.notificationKey(),String(Date.now()));}catch{}
  ui.showDialog('<h2 id="modal-title">การแจ้งเตือน</h2>'+body+'<button class="primary" id="close-live-notifications">ปิด</button>',dialog=>{dialog.querySelector('#close-live-notifications').onclick=()=>{dialog.close();emit();};});
 }
 function bind(ui){
  document.querySelectorAll('[data-score-reload]').forEach(b=>b.onclick=()=>{if(['session_expired','directory_session_missing'].includes(state.code))ui.signOut();else void load();});
  document.querySelector('#setup-live-scores')?.addEventListener('click',async event=>{
   const b=event.currentTarget;b.disabled=true;b.textContent='กำลังเตรียมคอลัมน์…';
   try{await root.GlowLogin.request('/hr/setup',{method:'POST',body:{}});await load();if(state.status!=='ready'||state.data.setup_required)throw Error(state.error||'ยังตรวจยืนยันคอลัมน์ตารางคะแนนไม่ได้ กรุณาตรวจการเชื่อมต่ออีกครั้ง');ui.toast('เตรียมคอลัมน์ตารางคะแนนแล้ว');}catch(error){b.disabled=false;b.textContent='เตรียมตารางคะแนน';ui.toast(error.message);}
  });
  document.querySelectorAll('[data-live-review]').forEach(b=>b.onclick=()=>{
   const id=b.dataset.liveReview,decision=b.dataset.decision,row=state.data?.reviews.find(r=>r.record_id===id);
   if(!row||row.status!=='รอ HR ตรวจสอบ')return;
   ui.showDialog('<h2 id="modal-title">'+(decision==='approved'?'Approve':'Reject')+' · '+e(row.dimension)+'</h2><p>'+e(row.name)+' · '+row.score+' ดาว</p><div class="field"><label for="live-review-note">ผลตรวจสอบ / เหตุผลการตัดสินใจ</label><textarea id="live-review-note" maxlength="500" required></textarea></div><p id="live-review-error" class="error" hidden></p><button class="primary" id="save-live-review">ยืนยันผลตรวจสอบ</button>',dialog=>{
    dialog.querySelector('#save-live-review').onclick=async()=>{
     const note=dialog.querySelector('#live-review-note').value.trim(),error=dialog.querySelector('#live-review-error'),button=dialog.querySelector('#save-live-review');
     if(!note){error.hidden=false;error.textContent='กรุณาระบุผลตรวจสอบก่อนยืนยัน';return;}
     button.disabled=true;
     try{await root.GlowLogin.request('/hr/reviews/'+encodeURIComponent(id),{method:'POST',body:{decision,note}});dialog.close();await load();ui.toast('บันทึกผลตรวจสอบใน Base แล้ว');}catch(err){button.disabled=false;error.hidden=false;error.textContent=err.message;}
    };
   });
  });
 }
 root.CubicScores={configure:value=>{hooks=value;},start:()=>{reset();return load();},reset,load,ready,round,notice,submit,home,hrView,bind,openNotifications,status:()=>state.status,data:()=>state.data,sending:()=>sending,refreshing:()=>refreshing,history,historyAvailable:()=>Array.isArray(state.data?.history)||confirmedHistory.length>0};
})(window);
