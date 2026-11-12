// A successful submission requires a Base receipt. Drafts use a separate account-scoped store.
(function(root){
 let state={status:'idle',data:null,error:'',code:''},generation=0,sequence=0,sending=false,refreshing=false,confirmedHistory=[],hooks={};
 let dashboard={status:'idle',data:null,round:'',error:''};
 const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const active=()=>root.GlowLogin.active(),admin=()=>root.GlowLogin.profile()?.role==='admin';
 const emit=()=>hooks.render?.();
 const numeric=v=>v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=1&&v<=5);
 const validRound=r=>typeof r==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(r);
 const validCount=n=>Number.isInteger(n)&&n>=0;
 const validSummary=r=>r&&numeric(r.overall)&&Array.isArray(r.dims)&&r.dims.length===3&&r.dims.every(d=>numeric(d.mean));
 const validHistoryAnswers=answers=>Array.isArray(answers)&&answers.length===3&&new Set(answers.map(a=>a.dimension)).size===3&&answers.every(a=>['ความเร็ว','ความถูกต้อง','การสื่อสาร'].includes(a.dimension)&&Number.isInteger(a.score)&&a.score>=1&&a.score<=5&&typeof a.reason==='string');
 const validHistory=h=>h&&typeof h.target==='string'&&typeof h.name==='string'&&typeof h.department==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(h.round)&&Number.isFinite(Date.parse(h.created))&&(h.answers===undefined||validHistoryAnswers(h.answers))&&(h.context===undefined||typeof h.context==='string');
 const validFeedback=f=>f&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(f.round)&&Number.isFinite(Date.parse(f.created))&&Array.isArray(f.answers)&&f.answers.length>0&&f.answers.length<=3&&new Set(f.answers.map(a=>a.dimension)).size===f.answers.length&&f.answers.every(a=>['ความเร็ว','ความถูกต้อง','การสื่อสาร'].includes(a.dimension)&&Number.isInteger(a.score)&&a.score>=1&&a.score<=5);
 function history(){
  if(!active())return [];
  const merged=new Map();
  for(const h of [...confirmedHistory,...(state.data?.history||[])]){const key=h.round+'|'+h.target,previous=merged.get(key);merged.set(key,{...previous,...h,answers:h.answers??previous?.answers,context:h.context??previous?.context});}
  return [...merged.values()];
 }
 function reset(){generation++;sequence++;state={status:'idle',data:null,error:'',code:''};dashboard={status:'idle',data:null,round:'',error:''};sending=false;refreshing=false;confirmedHistory=[];}
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
 async function submit(body,recipient){
  if(sending)throw Error('กำลังส่งการประเมิน กรุณารอสักครู่');
  const g=generation;sending=true;
  try{
   if(!ready())await load();
   if(g!==generation||!active())throw Object.assign(Error('บัญชีที่ใช้งานเปลี่ยนแล้ว'),{code:'session_changed'});
   if(!ready())throw Object.assign(Error('ยังส่งไม่สำเร็จ กรุณาลองอีกครั้ง'),{code:state.code||'score_unavailable'});
   const receipt=await root.GlowLogin.request('/assessments',{method:'POST',body});
   if(g!==generation||!active())throw Object.assign(Error('บัญชีที่ใช้งานเปลี่ยนแล้ว'),{code:'session_changed'});
   if(receipt.persisted!==true||receipt.answers!==3||typeof receipt.assessment_id!=='string')throw Error('ยังยืนยันการบันทึกครบ 3 ด้านไม่ได้ กรุณาลองส่งอีกครั้ง');
   // Use the submitted answers only when Base confirms all three answers were saved.
   const entry=receipt.history_entry||(recipient&&{target:body.target_id,round:body.round,name:recipient.name,department:recipient.dept,created:receipt.created});
   if(validHistory(entry)&&entry.target===body.target_id&&entry.round===body.round){
    const answers=['ความเร็ว','ความถูกต้อง','การสื่อสาร'].map((dimension,i)=>({dimension,score:body.scores?.[i],reason:String(body.reasons?.[i]||'').trim()}));
    confirmedHistory.push({...entry,...(!entry.answers&&validHistoryAnswers(answers)?{answers,context:String(body.context||'').trim()}: {})});
   }
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
  if(d.setup_required)out+='<section class="card"><h2>เตรียมตารางคะแนนใน Base</h2>'+(d.score_table_id?'<p>รหัสตาราง <code>'+e(d.score_table_id)+'</code></p>':'')+(missing.length?'<h3>คอลัมน์ที่ยังขาด ('+missing.length+')</h3><ul>'+missing.map(name=>'<li>'+e(name)+'</li>').join('')+'</ul>':'')+(invalid.length?'<div class="error"><p>กรุณาตรวจชนิดข้อมูลของคอลัมน์เหล่านี้ใน Base</p><ul>'+invalid.map(name=>'<li>'+e(name)+'</li>').join('')+'</ul></div>':'<p class="muted">เพิ่มคอลัมน์ที่ระบบต้องใช้บันทึกผลประเมิน</p><button class="primary" id="setup-live-scores" type="button">เตรียมตารางคะแนน</button>')+'</section>';
  return out;
 }
 function feedbackView(){
  if(state.status!=='ready'||!Array.isArray(state.data?.feedback))return '';
  const minimum=Math.max(3,state.data.summary.minimum_raters||0,state.data.policy.minimum_raters);
  const items=state.data.feedback.filter(f=>f.round===round());
  if(items.length<minimum)return '';
  // Older Workers also return one entry per rater and round, but send scores before the gate.
  const counts=new Map();
  for(const {answers} of items)for(const {dimension} of answers)counts.set(dimension,(counts.get(dimension)||0)+1);
  const visible=items.map(f=>({...f,answers:f.answers.filter(a=>counts.get(a.dimension)>=minimum)})).filter(f=>f.answers.length);
  if(!visible.length)return '';
  return '<section class="card received-feedback"><div class="row"><h2>ฟีดแบ็กที่ได้รับ</h2><span class="pill">'+e(monthLabel(round()))+'</span></div><div class="received-feedback-list">'+visible.map(f=>'<article class="received-feedback-item"><p class="muted">'+e(dateLabel(f.created))+'</p><div class="received-feedback-scores">'+f.answers.map(a=>'<div><span>'+e(a.dimension)+'</span><strong><span aria-hidden="true">★</span> '+a.score+' / 5</strong></div>').join('')+'</div></article>').join('')+'</div></section>';
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
 function pendingCount(){
  return admin()&&state.data?.round_state!=='released'
   ? (state.data?.reviews||[]).filter(r=>r.status==='รอ HR ตรวจสอบ').length : 0;
 }
 function hrHome(ui){
  return ui.head(greeting(),'รอบประเมิน '+e(monthLabel(round())),'',false)+setupNotice()+(ready()?`
   <section class="card hr-pending-card">
    <div><h2>คะแนนรออนุมัติ</h2><p class="muted">คะแนน 1–3 ดาว รอตรวจสอบเป็นรายด้าน</p></div>
    <button class="primary" type="button" data-nav="queue">ดูคิวอนุมัติ · ${pendingCount()} รายการ</button>
   </section>`:'');
 }
 async function loadDashboard(selected=''){
  if(!active()||!admin())return;
  const g=generation,previous=dashboard.data;
  const loading=dashboard={status:'loading',data:previous,round:selected,error:''};
  emit();
  try{
   const data=await root.GlowLogin.request('/hr/heatmap'+(selected?'?round='+encodeURIComponent(selected):''));
   if(g!==generation||dashboard!==loading||!active())return;
   const ranked=row=>row&&typeof row.department==='string'&&row.overall!==null&&numeric(row.overall)&&validCount(row.raters)&&row.raters>0;
   if(!validRound(data.round)||(selected&&data.round!==selected)||!Array.isArray(data.rounds)||!data.rounds.every(validRound)||
      !Array.isArray(data.dimensions)||data.dimensions.length!==3||data.dimensions.some(name=>typeof name!=='string')||
      !Array.isArray(data.rows)||data.rows.some(row=>!row||typeof row.department!=='string'||!Array.isArray(row.means)||row.means.length!==3||!row.means.every(numeric))||
      !validCount(data.counts?.raters)||!validCount(data.counts?.recipients)||
      !Array.isArray(data.rankings?.people)||!data.rankings.people.every(row=>ranked(row)&&typeof row.name==='string')||
      !Array.isArray(data.rankings?.departments)||!data.rankings.departments.every(ranked)){
    throw Error('ข้อมูลแดชบอร์ดไม่ถูกต้อง');
   }
   data.rounds=[...new Set([...(previous?.rounds||[]),...data.rounds])].sort().reverse();
   dashboard={status:'ready',data,round:data.round,error:''};
  }catch(error){
   if(g!==generation||dashboard!==loading||!active())return;
   dashboard={status:'error',data:previous,round:selected,error:error.message};
  }
  emit();
 }
 function heatmapView(data){
  const table=data.rows.length?`<div class="heatmap-table-wrap"><table class="heatmap-table">
   <caption class="sr-only">คะแนนเฉลี่ยตามแผนกผู้รับและด้านที่ประเมิน</caption>
   <thead><tr><th scope="col">แผนกผู้รับ</th>${data.dimensions.map(name=>`<th scope="col">${e(name)}</th>`).join('')}</tr></thead>
   <tbody>${data.rows.map(row=>`<tr><th scope="row">${e(row.department)}</th>${row.means.map(mean=>mean===null
    ? '<td class="heatmap-empty" aria-label="ยังไม่มีคะแนนที่ใช้คำนวณ">—</td>'
    : `<td class="heatmap-value heatmap-band-${Math.floor(mean)}">${mean.toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`:'<p class="muted">ยังไม่มีผลประเมินในรอบนี้</p>';
  return `<section class="card hr-heatmap" aria-labelledby="dashboard-heatmap-title">
   <h2 id="dashboard-heatmap-title">Heatmap</h2><p class="muted">คะแนนเฉลี่ยรายด้านตามแผนกของผู้ถูกประเมิน</p>
   ${table}
   <div class="heatmap-legend" role="group" aria-label="ความหมายของสี">
    <p>ความหมายของสี</p>
    <ul>
     ${['1.00–1.99','2.00–2.99','3.00–3.99','4.00–4.99','5.00'].map((range,i)=>`<li><span class="heatmap-swatch heatmap-band-${i+1}" aria-hidden="true"></span>${range}</li>`).join('')}
     <li><span class="heatmap-swatch heatmap-empty" aria-hidden="true">—</span>ยังไม่มีคะแนนที่ใช้คำนวณ</li>
    </ul>
   </div>
  </section>`;
 }
 function rankingView(rows,byPerson){
  const title=byPerson?'อันดับบุคคล':'อันดับแผนก',id=byPerson?'person-ranking':'department-ranking';
  let rank=0,lastScore=null;
  const body=rows.map((row,i)=>{
   if(row.overall!==lastScore)rank=i+1;
   lastScore=row.overall;
   return `<tr><td class="rank-number">${rank}</td>
    <th scope="row">${e(byPerson?row.name:row.department)}${byPerson&&row.department?`<small>${e(row.department)}</small>`:''}</th>
    <td class="rank-score">${row.overall.toFixed(2)}</td><td class="rank-raters">${row.raters.toLocaleString('th-TH')}</td></tr>`;
  }).join('');
  return `<section class="card dashboard-ranking" aria-labelledby="${id}">
   <h2 id="${id}">${title}</h2>
   ${rows.length?`<div class="ranking-table-wrap"><table class="ranking-table">
    <thead><tr><th scope="col">อันดับ</th><th scope="col">${byPerson?'ผู้ถูกประเมิน':'แผนก'}</th><th scope="col">คะแนน / 5</th><th scope="col">ผู้ประเมิน</th></tr></thead>
    <tbody>${body}</tbody></table></div>`:'<p class="muted">ยังไม่มีคะแนนครบทั้ง 3 ด้านในรอบนี้</p>'}
  </section>`;
 }
 function dashboardView(){
  if(!ready())return setupNotice();
  if(state.data.dashboard_available!==true)return '<section class="card"><p class="muted">เผยแพร่ Worker รุ่น scores-v3 เพื่อเปิดแดชบอร์ด HR</p></section>';
  const data=dashboard.data,selected=dashboard.round||round();
  const months=data?.rounds||[round()],loading=['idle','loading'].includes(dashboard.status);
  const summary=dashboard.status==='ready'?`
   <div class="dashboard-counts" role="group" aria-label="จำนวนคนไม่ซ้ำในรอบที่เลือก">
    <section class="card dashboard-count"><h2>ผู้ส่งการประเมิน</h2><p><strong>${data.counts.raters.toLocaleString('th-TH')}</strong> คน</p></section>
    <section class="card dashboard-count"><h2>ผู้ถูกประเมิน</h2><p><strong>${data.counts.recipients.toLocaleString('th-TH')}</strong> คน</p></section>
   </div>
   ${heatmapView(data)}
   <div class="dashboard-rankings">${rankingView(data.rankings.people,true)}${rankingView(data.rankings.departments,false)}</div>`
   : dashboard.status==='error'?'<p class="error" role="alert">'+e(dashboard.error)+'</p>':'<p class="muted" role="status">กำลังโหลดแดชบอร์ด…</p>';
  return `<div class="hr-dashboard">
   <div class="card dashboard-toolbar">
    <div class="field"><label for="dashboard-round">รอบประเมิน</label><select id="dashboard-round">${months.map(r=>`<option value="${e(r)}" ${r===selected?'selected':''}>${e(monthLabel(r))}</option>`).join('')}</select></div>
    <button class="secondary" id="refresh-dashboard" type="button" ${loading?'disabled':''}>${dashboard.status==='error'?'ลองอีกครั้ง':'โหลดข้อมูลล่าสุด'}</button>
   </div>
   ${summary}
  </div>`;
 }
 function hrView(page,ui){
  if(page==='hr')return ui.head('แดชบอร์ด HR','ภาพรวมการประเมินในแต่ละรอบ','',false)+dashboardView();
  if(page!=='queue')return hrHome(ui);
  const rows=state.data?.reviews||[];
  return ui.head('อนุมัติคะแนน','คะแนน 1–3 ดาว · เฉพาะ HR','',false)+setupNotice()+(ready()?'<section class="card"><button class="secondary" data-score-reload>โหลดรายการล่าสุด</button>'+rows.map(r=>'<article class="review-case"><div class="row"><div><p class="eyebrow">'+e(r.dimension)+'</p><h3>'+e(r.name)+' · '+e(r.department)+'</h3></div><span class="pill rose">'+r.score+' / 5</span></div><p class="muted">'+e(dateLabel(r.created))+'</p><blockquote>'+e(r.reason)+'</blockquote>'+(r.context?'<p class="muted">โปรเจกต์ '+e(r.context)+'</p>':'')+'<p>'+e(r.status)+'</p>'+(r.status==='รอ HR ตรวจสอบ'&&state.data.round_state!=='released'?'<div class="btn-group"><button class="secondary" data-live-review="'+e(r.record_id)+'" data-decision="approved">อนุมัติ</button><button class="danger" data-live-review="'+e(r.record_id)+'" data-decision="rejected">ไม่อนุมัติ</button></div>':r.note?'<p class="muted">'+e(r.note)+'</p>':'')+'</article>').join('')+(!rows.length?'<div class="empty"><h3>ไม่มีคะแนนที่ต้องตรวจสอบ</h3></div>':'')+'</section>':'');
 }
 async function openNotifications(ui){
  const g=generation;
  await load({quiet:true});if(g!==generation||!active()||admin())return;
  const rows=state.status==='ready'?state.data?.notifications||[]:[],grouped={};
  for(const r of rows){const date=dateLabel(r.created);grouped[date]=(grouped[date]||0)+r.count;}
  const total=rows.reduce((sum,r)=>sum+r.count,0);
  const body=state.status==='error'?'<p class="muted">การแจ้งเตือนจะแสดงที่นี่เมื่อพร้อม</p>':total?'<p class="muted">คุณได้รับฟีดแบ็ก '+total+' ชุดในช่วง 30 วันที่ผ่านมา</p>'+Object.entries(grouped).map(([day,count])=>'<div class="notification-item"><span>วันที่ส่ง '+e(day)+'</span><strong>ฟีดแบ็ก '+count+' ชุด</strong></div>').join(''):'<p class="muted">ยังไม่มีฟีดแบ็กใหม่ในช่วง 30 วันที่ผ่านมา</p>';
  if(state.status==='ready')try{localStorage.setItem(ui.notificationKey(),String(Date.now()));}catch{}
  ui.showDialog('<h2 id="modal-title">การแจ้งเตือน</h2>'+body+'<div class="notification-actions"><button class="danger" id="close-live-notifications" type="button">ปิด</button></div>',dialog=>{dialog.querySelector('#close-live-notifications').onclick=()=>{dialog.close();emit();};},'notification-dialog',false);
 }
 function bind(ui){
  const dashboardRound=document.querySelector('#dashboard-round');
  if(dashboardRound){
   dashboardRound.onchange=()=>void loadDashboard(dashboardRound.value);
   document.querySelector('#refresh-dashboard')?.addEventListener('click',()=>void loadDashboard(dashboard.round));
   if(dashboard.status==='idle')void loadDashboard();
  }
  document.querySelectorAll('[data-score-reload]').forEach(b=>b.onclick=()=>{if(['session_expired','directory_session_missing'].includes(state.code))ui.signOut();else void load();});
  document.querySelector('#setup-live-scores')?.addEventListener('click',async event=>{
   const b=event.currentTarget;b.disabled=true;b.textContent='กำลังเตรียมคอลัมน์…';
   try{await root.GlowLogin.request('/hr/setup',{method:'POST',body:{}});await load();if(state.status!=='ready'||state.data.setup_required)throw Error(state.error||'ยังตรวจยืนยันคอลัมน์ตารางคะแนนไม่ได้ กรุณาตรวจการเชื่อมต่ออีกครั้ง');ui.toast('เตรียมคอลัมน์ตารางคะแนนแล้ว');}catch(error){b.disabled=false;b.textContent='เตรียมตารางคะแนน';ui.toast(error.message);}
  });
  document.querySelectorAll('[data-live-review]').forEach(b=>b.onclick=()=>{
   const id=b.dataset.liveReview,decision=b.dataset.decision,row=state.data?.reviews.find(r=>r.record_id===id);
   if(!row||row.status!=='รอ HR ตรวจสอบ')return;
   const rejected=decision==='rejected',needsNote=rejected||state.data.approval_note_optional!==true;
   const label=rejected?'ไม่อนุมัติ':'อนุมัติ';
   const noteField=needsNote?'<div class="field"><label for="live-review-note">'+(rejected?'เหตุผลที่ไม่อนุมัติ':'ผลตรวจสอบ')+'</label><textarea id="live-review-note" maxlength="500" required></textarea></div>':'';
   ui.showDialog('<h2 id="modal-title">'+label+' · '+e(row.dimension)+'</h2><p>'+e(row.name)+' · '+row.score+' ดาว</p>'+noteField+'<p id="live-review-error" class="error" role="alert" hidden></p><div class="form-actions"><button class="secondary" id="cancel-live-review" type="button">ยกเลิก</button><button class="'+(rejected?'danger':'primary')+'" id="save-live-review" type="button">ยืนยัน'+label+'</button></div>',dialog=>{
    dialog.querySelector('#cancel-live-review').onclick=()=>dialog.close();
    dialog.querySelector('#save-live-review').onclick=async()=>{
     const field=dialog.querySelector('#live-review-note'),note=field?.value.trim(),error=dialog.querySelector('#live-review-error'),button=dialog.querySelector('#save-live-review');
     if(needsNote&&!note){error.hidden=false;error.textContent=rejected?'กรุณาระบุเหตุผลที่ไม่อนุมัติ':'กรุณาระบุผลตรวจสอบ';field.focus();return;}
     button.disabled=true;
     try{await root.GlowLogin.request('/hr/reviews/'+encodeURIComponent(id),{method:'POST',body:note?{decision,note}:{decision}});dashboard={status:'idle',data:null,round:'',error:''};dialog.close();await load();ui.toast('บันทึกผลตรวจสอบใน Base แล้ว');}catch(err){button.disabled=false;error.hidden=false;error.textContent=err.message;}
    };
   });
  });
 }
 root.CubicScores={configure:value=>{hooks=value;},start:()=>{reset();return load();},reset,load,ready,round,notice,submit,home,hrView,bind,openNotifications,pendingCount,status:()=>state.status,data:()=>state.data,sending:()=>sending,refreshing:()=>refreshing,history,historyAvailable:()=>Array.isArray(state.data?.history)||confirmedHistory.length>0};
})(window);
