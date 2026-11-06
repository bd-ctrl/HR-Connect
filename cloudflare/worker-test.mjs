import assert from 'node:assert/strict';
import worker from './worker.mjs';
const F={submission:'รหัสแบบประเมิน',round:'รอบประเมิน',name:'ผู้ถูกประเมิน',department:'แผนกผู้ถูกประเมิน',dimension:'หัวข้อประเมิน',score:'คะแนนดาว',reason:'เหตุผลประกอบ',status:'สถานะตรวจสอบ',note:'หมายเหตุ HR',reviewedAt:'วันที่ตรวจสอบ',target:'CC_รหัสผู้รับ',rater:'CC_รหัสผู้ประเมิน',context:'CC_โปรเจกต์',manifest:'CC_ข้อมูลยืนยัน',reviewer:'CC_รหัสผู้ตรวจสอบ',created:'วันที่ประเมิน'};
const env={LARK_APP_ID:'unit-test-app',LARK_APP_SECRET:'unit-test-secret-not-real',LARK_APP_TOKEN:'unit-test-base',LARK_TABLE_ID:'tblEmployees',LARK_SCORE_TABLE_ID:'tblScores',SCORE_STORAGE_PRIVATE:'true',EVALUATION_ROUND:'2026-10'};
const employees=[...['A','B','C','D'].map((key,i)=>({record_id:'rec'+key,fields:{เลขบัตรประชาชน:'111111111111'+i,ชื่อเล่น:'ทดสอบ'+key,แผนก:key==='B'?'HR':'BA',สถานะการเป็นพนักงาน:'พนักงาน',Role:'User'}})),{record_id:'recHR',fields:{เลขบัตรประชาชน:'0000912345678',ชื่อเล่น:'ADMIN',แผนก:'HR',สถานะการเป็นพนักงาน:'พนักงาน',Role:'Admin'}}];
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
 if(u.pathname.endsWith('/records/search'))return ok({items:structuredClone((table==='employee'?employees:records).filter(r=>b.filter.conditions.every(c=>String(r.fields[c.field_name]??'')===c.value[0])).slice(0,Number(u.searchParams.get('page_size'))||500)),has_more:false});
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
 eq((await api('/health')).data.version,'scores-v1');eq((await api('/me/state')).status,401);
 const a=await login('recA'),b=await login('recB'),c=await login('recC'),d=await login('recD'),hr=await login('recHR');
 eq((await api('/hr/state',{token:a})).status,403);
 eq((await api('/me/state',{token:a,settings:{...env,SCORE_STORAGE_PRIVATE:'false'}})).status,503);
 for(const [body,status] of [[{...payload,target_id:'recA'},403],[{...payload,scores:[3,4,4]},400],[{...payload,rater:'recC'},400],[{...payload,scores:[6,4,4]},400],[{...payload,round:'2026-09'},409]])eq((await api('/assessments',{token:a,body})).status,status);
 eq(records.length,0);failDimension='ความถูกต้อง';
 eq((await api('/assessments',{token:a,body:payload})).status,502);eq(records.length,1);eq((await api('/me/state',{token:b})).data.summary.received,0);
 const save=await api('/assessments',{token:a,body:payload});eq(save.status,200);yes(save.data.persisted);eq(records.length,3);
 eq((await api('/assessments',{token:a,body:payload})).status,200);eq(records.length,3);
 eq((await api('/assessments',{token:a,body:{...payload,scores:[5,5,5]}})).status,409);eq(records.length,3);
 const before=await api('/me/state',{token:b});eq(before.data.summary.received,1);eq(before.data.summary.overall,null);eq(before.data.summary.state,'insufficient_data');
 eq((await api('/me/state?target=recA',{token:b})).status,400);eq((await api('/me/state',{token:a})).data.history.length,1);eq((await api('/me/state',{token:b})).data.history.length,0);
 omitCreatedFields=true;eq((await api('/assessments',{token:c,body:payload})).status,200);
 eq((await api('/assessments',{token:d,body:{...payload,scores:[2,5,4],reasons:['สถานการณ์สมมติ','','']}})).status,200);
 // All three answers, including the low score awaiting HR, already exist in Base before HR reads them.
 eq(records.length,9);eq(records.filter(r=>r.fields[F.status]==='รอ HR ตรวจสอบ').length,1);
 const pending=await api('/me/state',{token:b});eq(pending.data.summary.received,3);eq(pending.data.summary.overall,null);eq(pending.data.summary.dims[1].mean,5);
 const serialized=JSON.stringify(pending.data);yes(!serialized.includes('สถานการณ์สมมติ')&&!serialized.includes('recA')&&!serialized.includes('rater_id'));
 const q=await api('/hr/state',{token:hr});eq(q.status,200);eq(q.data.reviews.length,1);yes(!JSON.stringify(q.data).includes('CC_รหัสผู้ประเมิน'));
 const low=q.data.reviews[0].record_id;
 eq((await api('/hr/reviews/'+low,{token:hr,body:{decision:'approved',note:'ห้ามแก้รอบปิด'},settings:{...env,ROUND_STATE:'released'}})).status,409);
 eq((await api('/hr/reviews/'+low,{token:a,body:{decision:'approved',note:'ผลทดสอบ'}})).status,403);
 eq((await api('/hr/reviews/'+low,{token:hr,body:{decision:'approved',note:''}})).status,400);
 eq((await api('/hr/reviews/'+low,{token:hr,body:{decision:'approved',note:'ผลทดสอบ'}})).status,200);
 eq((await api('/hr/reviews/'+low,{token:hr,body:{decision:'rejected',note:'แก้ผล'}})).status,409);
 const after=await api('/me/state',{token:b});eq(after.data.summary.state,'ready');yes(Math.abs(after.data.summary.overall-37/9)<1e-10);
 const other={...payload,target_id:'recC',scores:[2,5,4],reasons:['เหตุการณ์สมมติอีกกรณี','','']};
 eq((await api('/assessments',{token:a,body:other,settings:{...env,MIN_RATERS:'1'}})).status,200);
 const rejectCase=(await api('/hr/state',{token:hr})).data.reviews.find(r=>r.status==='รอ HR ตรวจสอบ');
 yes(!!rejectCase);
 eq((await api('/hr/reviews/'+rejectCase.record_id,{token:hr,body:{decision:'rejected',note:'ไม่ใช้คะแนนด้านนี้ในการคำนวณ'}})).status,200);
 const rejected=(await api('/me/state',{token:c,settings:{...env,MIN_RATERS:'1'}})).data.summary;
 eq(rejected.overall,null);eq(rejected.dims[1].mean,5);

 const dup=structuredClone(records[0]);dup.record_id='recDuplicate';records.push(dup);eq((await api('/me/state',{token:b})).data.summary.received,3);
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
}finally{globalThis.fetch=nativeFetch;}

