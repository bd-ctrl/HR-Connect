import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.mjs';
const F={submission:'รหัสแบบประเมิน',round:'รอบประเมิน',name:'ผู้ถูกประเมิน',department:'แผนกผู้ถูกประเมิน',dimension:'หัวข้อประเมิน',score:'คะแนนดาว',reason:'เหตุผลประกอบ',status:'สถานะตรวจสอบ',note:'หมายเหตุ HR',reviewedAt:'วันที่ตรวจสอบ',target:'CC_รหัสผู้รับ',rater:'CC_รหัสผู้ประเมิน',context:'CC_โปรเจกต์',manifest:'CC_ข้อมูลยืนยัน',reviewer:'CC_รหัสผู้ตรวจสอบ',created:'วันที่ประเมิน'};
const env={LARK_APP_ID:'unit-test-app',LARK_APP_SECRET:'unit-test-secret-not-real',LARK_APP_TOKEN:'unit-test-base',LARK_TABLE_ID:'tblEmployees',LARK_SCORE_TABLE_ID:'tblScores',SCORE_STORAGE_PRIVATE:'true',EVALUATION_ROUND:'2026-10'};
const employees=[...['A','B','C','D'].map((key,i)=>({record_id:'rec'+key,fields:{เลขบัตรประชาชน:'111111111111'+i,ชื่อเล่น:'ทดสอบ'+key,แผนก:key==='B'?'HR':'BA',สถานะการเป็นพนักงาน:'พนักงาน',Role:'User'}})),{record_id:'recHR',fields:{เลขบัตรประชาชน:'0000912345678',ชื่อเล่น:'ผู้ทดสอบ HR',แผนก:'HR',สถานะการเป็นพนักงาน:'พนักงาน',Role:'Admin'}},{record_id:'recDual',fields:{เลขบัตรประชาชน:'0000987654321',ชื่อเล่น:'ผู้ทดสอบสองบทบาท',แผนก:'HR',สถานะการเป็นพนักงาน:'พนักงาน',Role:['Admin','User']}}];
const db=new DatabaseSync(':memory:');
const draftEnv={...env,DRAFTS_DB:{prepare(sql){
  const statement=db.prepare(sql);
  return {
    async run(){return statement.run();},
    bind(...args){return {async first(){return statement.get(...args)??null;},async run(){return statement.run(...args);}};}
  };
}}};
let fields=new Map(),records=[],tokens=new Map(),seq=0,failDimension='',omitCreatedFields=false,hideCreatedField=false;
for(const [k,n] of Object.entries(F))fields.set(n,{field_id:'fld'+k,field_name:n,type:k==='score'?2:['created','reviewedAt'].includes(k)?5:1});
const ok=data=>Response.json({code:0,data}),nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const u=new URL(input),method=options.method||'GET',b=options.body?JSON.parse(options.body):null;
 assert.equal(u.origin,'https://open.larksuite.com');
 if(u.pathname.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'unit-test-tenant',expire:7200});
 const table=u.pathname.includes('/tblEmployees/')?'employee':'score';
 if(u.pathname.endsWith('/fields')){
  if(method==='GET')return ok({items:[...fields.values()],has_more:false});
  const f={...b,field_id:'fld'+(++seq)};if(hideCreatedField)hideCreatedField=false;else fields.set(f.field_name,f);return ok({field:f});
 }
 const id=u.pathname.endsWith('/records/search')?null:u.pathname.match(/\/records\/([^/]+)$/)?.[1];
 if(id){
  const row=(table==='employee'?employees:records).find(r=>r.record_id===id);
  if(!row)return Response.json({code:1254040},{status:404});
  if(method==='PUT'){
   const key=u.searchParams.get('client_token');
   if(!tokens.has(key)){Object.assign(row.fields,b.fields);tokens.set(key,structuredClone(row));}
   return ok({record:structuredClone(tokens.get(key))});
  }
  return ok({record:structuredClone(row)});
 }
 if(u.pathname.endsWith('/records/search'))return ok({items:structuredClone((table==='employee'?employees:records).filter(r=>(b.filter?.conditions||[]).every(c=>String(r.fields[c.field_name]??'')===c.value[0])).slice(0,Number(u.searchParams.get('page_size'))||500)),has_more:false});
 if(u.pathname.endsWith('/records')&&method==='POST'){
  assert.ok(!Object.hasOwn(b.fields,'เลขบัตรประชาชน'));assert.match(u.searchParams.get('client_token'),/^[a-f0-9-]{36}$/);
  if(failDimension&&b.fields[F.dimension]===failDimension){failDimension='';throw Error('simulated lost network');}
  const key=u.searchParams.get('client_token');
  if(!tokens.has(key)){const record={record_id:'recScore'+(++seq),fields:structuredClone(b.fields)};records.push(record);tokens.set(key,structuredClone(record));}
  if(omitCreatedFields){omitCreatedFields=false;return ok({record:{record_id:tokens.get(key).record_id}});}
  return ok({record:structuredClone(tokens.get(key))});
 }
 throw Error('Unhandled API '+method+' '+u.pathname);
};
let checks=0;function eq(a,b){assert.deepEqual(a,b);checks++;}function yes(v){assert.ok(v);checks++;}
async function api(path,{token,body,method=body?'POST':'GET',settings=env}={}){
 const r=await worker.fetch(new Request('https://unit-test.workers.dev'+path,{method,headers:{Origin:'https://bd-ctrl.github.io',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),settings);
 return {status:r.status,data:await r.json()};
}
async function login(key){const id=employees.find(e=>e.record_id===key).fields.เลขบัตรประชาชน;const r=await api('/login',{body:key==='recHR'?{admin_code:id}:{national_id:id}});eq(r.status,200);return r.data.session_token;}
const payload={target_id:'recB',round:'2026-10',scores:[4,5,4],reasons:['','',''],context:'ทดสอบข้อมูลสมมติ'};
try{
 eq((await api('/health')).data.version,'scores-v3');eq((await api('/me/state')).status,401);
 const a=await login('recA'),b=await login('recB'),c=await login('recC'),d=await login('recD');
 eq((await api('/hr/state',{token:a})).status,403);
 const dual=employees.find(row=>row.record_id==='recDual');
 const adminCode=dual.fields.เลขบัตรประชาชน;
 const picker=await api('/login',{body:{admin_code:adminCode}});
 eq(picker.status,200);eq(picker.data.roles,['employee','admin']);eq(picker.data.session_token,undefined);
 const employeeMode=(await api('/login',{body:{admin_code:adminCode,role:'employee'}})).data;
 const adminMode=(await api('/login',{body:{admin_code:adminCode,role:'admin'}})).data;
 eq(employeeMode.employee.role,'employee');eq(adminMode.employee.role,'admin');
 eq((await api('/hr/state',{token:employeeMode.session_token})).status,403);
 eq((await api('/hr/state',{token:adminMode.session_token})).status,200);
 eq((await api('/me/state',{token:adminMode.session_token})).status,403);
 eq((await api('/login',{body:{national_id:adminCode,role:'admin'}})).status,403);
 const roster=(await api('/employees',{token:a})).data.employees;
 yes(roster.some(person=>person.id==='recDual'));yes(!roster.some(person=>person.id==='recHR'||person.id==='recA'));
 dual.fields.Role='Not Admin';
 eq((await api('/login',{body:{admin_code:adminCode}})).status,403);
 eq((await api('/hr/state',{token:adminMode.session_token})).status,403);
 dual.fields.Role=[{text:'Not '},{text:'Admin'}];
 eq((await api('/login',{body:{admin_code:adminCode}})).status,403);
 dual.fields.Role=['Admin','User'];
 eq((await api('/me/state',{token:a,settings:{...env,SCORE_STORAGE_PRIVATE:'false'}})).status,503);
 const path='/me/drafts/recB',draft={round:'2026-10',revision:0,scores:[2,null,5],reasons:['','',''],context:'ร่างจากเครื่องแรก'};
 eq((await api('/me/state',{token:a,settings:draftEnv})).data.draft_sync,true);
 eq((await api(path,{token:a})).status,503);
 eq((await api(path,{token:a,settings:draftEnv})).data.draft,null);
 eq((await api(path,{token:a,settings:draftEnv,body:draft})).data.revision,1);
 const secondDevice=await login('recA');
 const restored=(await api(path,{token:secondDevice,settings:draftEnv})).data.draft;
 eq(restored.context,draft.context);eq(restored.scores,draft.scores);eq(restored.revision,1);
 eq((await api(path,{token:c,settings:draftEnv})).data.draft,null);
 eq((await api(path,{token:adminMode.session_token,settings:draftEnv})).status,403);
 eq((await api(path,{token:a,settings:{...draftEnv,EVALUATION_ROUND:'2026-11'}})).data.draft,null);
 const draftWrites=await Promise.all([
  api(path,{token:secondDevice,settings:draftEnv,body:{...draft,revision:1,context:'ร่างล่าสุด'}}),
  api(path,{token:a,settings:draftEnv,body:{...draft,revision:1,context:'ร่างอีกเครื่อง'}})
 ]);
 eq(draftWrites.map(write=>write.status).sort(),[200,409]);
 eq((await api(path,{token:a,settings:draftEnv})).data.draft.revision,2);
 eq((await api(path,{token:a,settings:draftEnv,body:{...draft,scores:[null,null,6]}})).status,400);
 for(const [body,status] of [[{...payload,target_id:'recA'},403],[{...payload,scores:[3,4,4]},400],[{...payload,rater:'recC'},400],[{...payload,scores:[6,4,4]},400],[{...payload,round:'2026-09'},409]])eq((await api('/assessments',{token:a,body})).status,status);
 eq(records.length,0);failDimension='ความถูกต้อง';
 eq((await api('/assessments',{token:a,body:payload})).status,502);eq(records.length,1);eq((await api('/me/state',{token:b})).data.summary.received,0);
 eq((await api('/me/state',{token:b})).data.feedback,[]);eq((await api('/me/state',{token:a})).data.history,[]);
 const save=await api('/assessments',{token:a,body:payload,settings:draftEnv});eq(save.status,200);yes(save.data.persisted);eq(records.length,3);
 eq((await api(path,{token:secondDevice,settings:draftEnv})).data.draft,null);
 eq(save.data.history_entry.target,'recB');eq(save.data.history_entry.name,'ทดสอบB');eq(save.data.history_entry.round,payload.round);
 eq(save.data.history_entry.context,payload.context);eq(save.data.history_entry.answers.map(a=>a.score),[4,5,4]);
 eq((await api('/me/state',{token:a})).data.history[0].answers,save.data.history_entry.answers);
 yes(!JSON.stringify(save.data.history_entry).includes('rater'));
 eq((await api('/assessments',{token:a,body:payload})).status,200);eq(records.length,3);
 eq((await api('/assessments',{token:a,body:{...payload,scores:[5,5,5]}})).status,409);eq(records.length,3);
 const before=await api('/me/state',{token:b});eq(before.data.summary.received,1);eq(before.data.summary.overall,null);eq(before.data.summary.state,'insufficient_data');
 // The first submission contributes to HR's dashboard. The recipient gets a count-only notice.
 eq(before.data.feedback,[]);
 eq(before.data.notifications.reduce((sum,n)=>sum+n.count,0),1);
 const hr=await login('recHR');
 const firstDashboard=(await api('/hr/heatmap',{token:hr})).data;
 eq(firstDashboard.counts,{raters:1,recipients:1});
 eq(firstDashboard.rows,[{department:'HR',means:[4,5,4]}]);
 eq(firstDashboard.rankings,{
  people:[{name:'ทดสอบB',department:'HR',overall:4.33,raters:1}],
  departments:[{department:'HR',overall:4.33,raters:1}]
 });
 eq((await api('/me/state?target=recA',{token:b})).status,400);eq((await api('/me/state',{token:a})).data.history.length,1);eq((await api('/me/state',{token:b})).data.history.length,0);
 omitCreatedFields=true;eq((await api('/assessments',{token:c,body:payload})).status,200);
 eq((await api('/me/state',{token:b})).data.feedback,[]);
 eq((await api('/assessments',{token:d,body:{...payload,scores:[2,5,4],reasons:['สถานการณ์สมมติ','','']}})).status,200);
 // All three answers, including the low score awaiting HR, already exist in Base before HR reads them.
 eq(records.length,9);eq(records.filter(r=>r.fields[F.status]==='รอ HR ตรวจสอบ').length,1);
 const ownPending=(await api('/me/state',{token:d})).data.history[0];
 eq(ownPending.answers.map(a=>a.score),[2,5,4]);eq(ownPending.answers[0].reason,'สถานการณ์สมมติ');
 const pending=await api('/me/state',{token:b});eq(pending.data.summary.received,3);eq(pending.data.summary.overall,null);eq(pending.data.summary.dims[1].mean,5);
 eq(pending.data.feedback.length,3);
 yes(pending.data.feedback.every(f=>f.answers.map(a=>a.dimension).join('|')==='ความถูกต้อง|การสื่อสาร'));
 eq(Object.keys(pending.data.feedback[0]).sort(),['answers','created','round']);
 const serialized=JSON.stringify(pending.data);yes(!serialized.includes('สถานการณ์สมมติ')&&!serialized.includes('recA')&&!serialized.includes('rater_id'));
 const q=await api('/hr/state',{token:hr});eq(q.status,200);eq(q.data.reviews.length,1);yes(!JSON.stringify(q.data).includes('CC_รหัสผู้ประเมิน'));
 eq(q.data.approval_note_optional,true);
 eq(q.data.dashboard_available,true);
 eq((await api('/hr/heatmap',{token:a})).status,403);
 eq((await api('/hr/heatmap?round=2026-13',{token:hr})).status,400);
 const pendingHeatmap=(await api('/hr/heatmap',{token:hr})).data;
 eq(pendingHeatmap.rows,[{department:'HR',means:[4,5,4]}]);
 eq(pendingHeatmap.counts,{raters:3,recipients:1});
 yes([records[0].fields[F.rater],payload.context,'สถานการณ์สมมติ','recB','record_id'].every(value=>!JSON.stringify(pendingHeatmap).includes(value)));
 const low=q.data.reviews[0].record_id;
 eq((await api('/hr/reviews/'+low,{token:hr,body:{decision:'approved',note:'ห้ามแก้รอบปิด'},settings:{...env,ROUND_STATE:'released'}})).status,409);
 eq((await api('/hr/reviews/'+low,{token:a,body:{decision:'approved',note:'ผลทดสอบ'}})).status,403);
 eq((await api('/hr/reviews/'+low,{token:hr,body:{decision:'rejected',note:''}})).status,400);
 eq((await api('/hr/reviews/'+low,{token:hr,body:{decision:'approved'}})).status,200);
 eq(records.find(row=>row.record_id===low).fields[F.reviewer],'recHR');
 eq(records.find(row=>row.record_id===low).fields[F.note],'');
 eq((await api('/hr/reviews/'+low,{token:hr,body:{decision:'approved'}})).status,200);
 eq((await api('/hr/reviews/'+low,{token:hr,body:{decision:'rejected',note:'แก้ผล'}})).status,409);
 const after=await api('/me/state',{token:b});eq(after.data.summary.state,'ready');yes(Math.abs(after.data.summary.overall-37/9)<1e-10);
 yes(after.data.feedback.some(f=>f.answers.some(a=>a.score===2)));yes(!JSON.stringify(after.data.feedback).includes('ผลทดสอบ'));
 eq((await api('/hr/heatmap?round=2026-10',{token:hr})).data.rows,[{department:'HR',means:[3.33,5,4]}]);
 eq((await api('/hr/heatmap?round=2026-09',{token:hr})).data.rows,[]);
 const other={...payload,target_id:'recC',scores:[2,5,4],reasons:['เหตุการณ์สมมติอีกกรณี','','']};
 eq((await api('/assessments',{token:a,body:other,settings:{...env,MIN_RATERS:'1'}})).status,200);
 const rejectCase=(await api('/hr/state',{token:hr})).data.reviews.find(r=>r.status==='รอ HR ตรวจสอบ');
 yes(!!rejectCase);
 eq((await api('/hr/reviews/'+rejectCase.record_id,{token:hr,body:{decision:'rejected',note:'ไม่ใช้คะแนนด้านนี้ในการคำนวณ'}})).status,200);
 const rejected=(await api('/me/state',{token:c,settings:{...env,MIN_RATERS:'1'}})).data.summary;
 eq(rejected.overall,null);eq(rejected.dims[1].mean,5);
 eq((await api('/me/state',{token:c})).data.feedback,[]);
 const partialDashboard=(await api('/hr/heatmap',{token:hr})).data;
 eq(partialDashboard.rows.find(row=>row.department==='BA').means,[null,5,4]);
 eq(partialDashboard.counts,{raters:3,recipients:2});
 yes(!partialDashboard.rankings.departments.some(row=>row.department==='BA'));
 const allLow={...payload,target_id:'recD',scores:[2,3,1],reasons:['เหตุผลจำลองหนึ่ง','เหตุผลจำลองสอง','เหตุผลจำลองสาม']};
 eq((await api('/assessments',{token:b,body:allLow})).status,200);
 const waitingLow=(await api('/me/state',{token:d})).data;
 eq(waitingLow.feedback,[]);eq(waitingLow.notifications,[]);
 yes((await api('/me/state',{token:b})).data.history.some(h=>h.target==='recD'));

 const sameDepartment={...payload,target_id:'recD',scores:[5,4,5]};
 eq((await api('/assessments',{token:a,body:sameDepartment})).status,200);
 eq((await api('/assessments',{token:c,body:{...sameDepartment,scores:[4,4,4]}})).status,200);
 const multiple=(await api('/hr/heatmap',{token:hr})).data;
 eq(multiple.counts,{raters:4,recipients:3});
 eq(multiple.rows.find(row=>row.department==='BA').means,[4.5,4.25,4.25]);
 eq(multiple.rankings.people.map(row=>[row.name,row.overall,row.raters]),[['ทดสอบD',4.33,2],['ทดสอบB',4.11,3]]);
 eq(multiple.rankings.departments.map(row=>[row.department,row.overall,row.raters]),[['BA',4.33,2],['HR',4.11,3]]);
 const historicalRound='2025-12';
 eq((await api('/assessments',{token:a,body:{...payload,round:historicalRound},settings:{...env,EVALUATION_ROUND:historicalRound}})).status,200);
 const historical=(await api('/hr/heatmap?round='+historicalRound,{token:hr})).data;
 eq(historical.counts,{raters:1,recipients:1});eq(historical.rows,[{department:'HR',means:[4,5,4]}]);
 eq((await api('/hr/heatmap',{token:hr})).data.rounds,['2026-10',historicalRound]);
 eq((await api('/me/state',{token:b})).data.feedback.filter(row=>row.round===historicalRound),[]);

 const dup=structuredClone(records[0]);dup.record_id='recDuplicate';records.push(dup);eq((await api('/me/state',{token:b})).data.summary.received,3);eq((await api('/me/state',{token:b})).data.feedback.length,3);
 employees[0].fields.สถานะการเป็นพนักงาน='พ้นสภาพ';eq((await api('/me/state',{token:a})).status,403);employees[0].fields.สถานะการเป็นพนักงาน='พนักงาน';
 eq((await api('/me/state',{token:a.slice(0,-2)+'zz'})).status,401);
 const rowsBeforeSetup=structuredClone(records);
 fields.delete(F.target);eq((await api('/me/state',{token:b})).status,503);
 const diagnostics=(await api('/hr/state',{token:hr})).data;
 eq(diagnostics.missing,[F.target]);eq(diagnostics.invalid_fields,[]);eq(diagnostics.score_table_id,env.LARK_SCORE_TABLE_ID);
 fields.get(F.score).type=3;
 const wrongType=(await api('/hr/state',{token:hr})).data;
 eq(wrongType.invalid_fields,[F.score]);yes(wrongType.setup_required);
 const fieldsBefore=fields.size;
 eq((await api('/hr/setup',{token:a,body:{}})).status,403);eq(fields.size,fieldsBefore);
 const blockedSetup=await api('/hr/setup',{token:hr,body:{}});
 eq(blockedSetup.status,503);eq(blockedSetup.data.error,'score_field_type');yes(blockedSetup.data.message.includes(F.score));eq(fields.size,fieldsBefore);
 fields.get(F.score).type=2;
 hideCreatedField=true;
 eq((await api('/hr/setup',{token:hr,body:{}})).status,503);yes(!fields.has(F.target));
 const setup=await api('/hr/setup',{token:hr,body:{}});eq(setup.status,200);yes(setup.data.created.includes(F.target));yes(setup.data.ready);
 const ready=(await api('/hr/state',{token:hr})).data;eq(ready.setup_required,false);eq(ready.invalid_fields,[]);
 eq((await api('/hr/setup',{token:hr,body:{}})).data.created,[]);eq(records,rowsBeforeSetup);
 console.log(`Worker scores: ${checks} checks passed with synthetic Base responses; no live data written.`);
}finally{globalThis.fetch=nativeFetch;db.close();}

