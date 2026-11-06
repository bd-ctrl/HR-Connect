import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
let checks = 0;
const ok = value => {assert.ok(value);checks++;};

function fixture(mode = 'success') {
  const elements = new Map(), storage = new Map(), calls = [];
  const q = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML:'',value:'',textContent:'',hidden:true,disabled:false,
      handlers:{},classList:{add(){},remove(){}},
      addEventListener(name, fn){this.handlers[name]=fn;},
      setAttribute(){},removeAttribute(){},focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;}
    });
    return elements.get(selector);
  };
  let clock = Date.now(), resolveDirectory, resolveSave, resolveHistory, historyReads=0, history=mode==='already-assessed'?[{target:'rec-project',name:'โครงการใหม่',department:'Project Co',round:'2026-10',created:'2026-10-29T08:00:00Z'}]:[],setupPrepared=false;
  const isHR=mode.startsWith('hr-');
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const context = {
    document:{querySelector:q,querySelectorAll:()=>[],addEventListener(){}},
    window:{scrollTo(){}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    matchMedia:()=>({matches:true}),Date:TestDate,
    AbortSignal,Response,structuredClone,setTimeout:()=>0,clearTimeout(){},
    fetch:async (url, options) => {
      calls.push({url,options});
      if(url.endsWith('/login'))return Response.json({
        ok:true,employee:{id:'rec-self',nickname:isHR?'ADMIN':mode==='nickname-escape'?'<img src=x onerror="bad()">':'ผู้ทดสอบ',department:isHR?'HR':'BA',role:isHR?'admin':'employee'},
        ...(mode==='no-session'?{}:{session_token:'test-session-token',expires_in:900})
      });
      if(url.endsWith('/hr/state'))return Response.json({ok:true,round:'2026-10',policy:{version:'test',minimum_raters:3},reviews:[],storage_private:true,score_table_id:'tblScores',setup_required:mode==='hr-wrong-type'||!setupPrepared||mode==='hr-setup-stale',missing:setupPrepared&&mode!=='hr-setup-stale'?[]:['CC_รหัสผู้รับ'],invalid_fields:mode==='hr-wrong-type'?['คะแนนดาว']:[]});
      if(url.endsWith('/hr/setup')){setupPrepared=true;return Response.json({ok:true,created:['CC_รหัสผู้รับ'],storage_private:true,ready:true});}
      if(url.endsWith('/me/state')){
        historyReads++;
        if(mode==='pending-history'&&historyReads>1)await new Promise(resolve=>{resolveHistory=resolve;});
        if(mode==='late-history'&&historyReads>1)history=[{target:'rec-project',name:'โครงการใหม่',department:'Project Co',round:'2026-10',created:'2026-10-29T08:00:00Z'}];
        if(mode==='history-read-fails'&&history.length)return Response.json({ok:false,error:'lark_unavailable',message:'simulated read failure'},{status:502});
        if(mode==='score-unauthorized')return new Response('Session expired',{status:401});
        if(mode==='api-missing')return Response.json({ok:false,error:'not_found'},{status:404});
        if(mode==='score-setup-required')return Response.json({ok:false,error:'score_setup_required',message:'HR ต้องเตรียมคอลัมน์ตารางคะแนนก่อนใช้งาน'},{status:503});
        if(mode==='score-private')return Response.json({ok:false,error:'score_storage_not_private',message:'ระบบคะแนนยังไม่พร้อมใช้งาน กรุณาให้ HR ตรวจการจำกัดสิทธิ์ Base'},{status:503});
        return Response.json({ok:true,round:'2026-10',round_state:mode==='closed-round'?'review':'open',policy:{version:'test',minimum_raters:3},summary:{round:'2026-10',received:mode==='instant-feedback'?1:0,state:mode==='instant-feedback'?'insufficient_data':'no_evaluations',overall:null,dims:[0,1,2].map(()=>({mean:null}))},previous:{round:'2026-09',overall:null,dims:[0,1,2].map(()=>({mean:null}))},feedback:mode==='instant-feedback'?[{round:'2026-10',created:'2026-10-29T08:00:00Z',answers:[{dimension:'ความเร็ว',score:4},{dimension:'การสื่อสาร',score:5}]}]:[],history,notifications:[]});
      }
      if(url.endsWith('/assessments')){
        assert.equal(options.headers.Authorization,'Bearer test-session-token');
        const body=JSON.parse(options.body);
        assert.ok(!('national_id' in body)&&!('rater' in body));
        if(mode==='pending-save')await new Promise(resolve=>{resolveSave=resolve;});
        if(mode==='save-error')return Response.json({ok:false,error:'save_unconfirmed',message:'ยังยืนยันการบันทึกไม่ได้'},{status:502});
        if(mode==='save-setup-required')return Response.json({ok:false,error:'score_setup_required',message:'ระบบบันทึกคะแนนยังตั้งค่าไม่ครบ กรุณาติดต่อผู้ดูแลระบบ'},{status:503});
        if(mode==='invalid-receipt')return Response.json({ok:true});
        history.push({target:body.target_id,name:'ผู้ทดสอบรับ',department:'HR & Admin',round:body.round,created:new Date().toISOString()});
        return Response.json({ok:true,persisted:true,answers:3,assessment_id:'test-assessment',history_entry:history.at(-1)});
      }
      assert.ok(url.endsWith('/employees'));
      assert.equal(options.headers.Authorization,'Bearer test-session-token');
      if(mode==='pending')await new Promise(resolve=>{resolveDirectory=resolve;});
      if(mode==='unauthorized')return Response.json({ok:false},{status:401});
      if(mode==='error')throw new TypeError('network unavailable');
      if(mode==='invalid')return Response.json({ok:true,employees:[{id:'missing-data'}]});
      const employees=mode==='empty'?[]:[
        {id:'rec-self',nickname:'ผู้ทดสอบ',department:'BA'},
        {id:'rec-project',nickname:'โครงการใหม่',department:'Project Co'},
        {id:'rec-hr',nickname:'<img src=x onerror="bad()">',department:'HR & Admin'}
      ];
      return Response.json({ok:true,employees});
    }
  };
  vm.createContext(context);
  vm.runInContext(read('login.js'),context);
  context.GlowLogin=context.window.GlowLogin;
  vm.runInContext(read('live-scores.js'),context);
  vm.runInContext(read('logic.js'),context);
  context.GlowLogic=context.window.GlowLogic;
  vm.runInContext(read('app.js'),context);
  return {
    context,q,calls,storage,
    run:code=>vm.runInContext(code,context),
    async login(){
      q('#employee-code').value='1111111111111';
      await q('#employee-login').onsubmit({preventDefault(){}});
    },
    expire(){clock+=16*60000;},
    setTime(iso){clock=Date.parse(iso);},
    finish(){resolveDirectory?.();resolveSave?.();resolveHistory?.();}
  };
}

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const beginDisabled=f=>/<button[^>]*id="begin-person"[^>]*\sdisabled/.test(f.q('#app').innerHTML);
const f=fixture();
ok(f.calls.length===0);
await f.login();
ok(f.run('GlowLogin.profile().id')==='rec-self');
ok(f.run('storageKey')==='cubic-connect-prototype-v2:employee:rec-self');
f.run("go('rate')");
ok(f.run('directory.status')==='loading');
ok(f.q('#app').innerHTML.includes('กำลังโหลดรายชื่อพนักงาน'));
await tick();
ok(f.run('directory.status')==='ready');
ok(f.run('eligible.length')===2 && !f.run("eligible.includes('rec-self')"));
ok(f.calls.filter(call=>call.url.endsWith('/employees')).length===1);
const picker=f.run("targetPicker('Project Co')");
ok(picker.includes('โครงการใหม่') && !picker.includes('นนท์') && !picker.includes('พลอย'));
ok(!picker.includes('<option value="rec-hr"'));
const escapedPicker=f.run("targetPicker('HR & Admin')");
ok(escapedPicker.includes('HR &amp; Admin') && escapedPicker.includes('&lt;img'));
ok(!escapedPicker.includes('<img src=x'));
f.run("start('rec-hr')");
ok(f.run('form.target')==='rec-hr' && !f.q('#app').innerHTML.includes('<img src=x'));
ok(f.q('#app').innerHTML.includes('&lt;img'));
ok(!f.q('#app').innerHTML.includes('id="collaborated"'));
f.run("form.scores=[4,4,5];form.reasons=['','',''];form.collaborated=false");
await f.q('#review-form').handlers.click();
ok(f.run('stage')==='review');
ok(f.q('#app').innerHTML.includes('ผู้รับเห็นคะแนน 4–5 ดาวทันที'));
ok(f.q('#app').innerHTML.includes('ยืนยันส่งการประเมิน'));
f.run('showDialog=content=>{globalThis.savedDialog=content}');
await f.q('#submit-form').handlers.click();
ok(f.run("Scores.history().some(row=>row.target==='rec-hr')"));
ok(f.run('savedDialog').includes('บันทึกผลประเมินครบ 3 ด้านแล้ว'));
ok(f.run("GlowLogic.validate({target:'rec-project',scores:[4,4,5],reasons:['','','']},'open',[],eligible,ROUND).length")===0);
ok(f.run("GlowLogic.validate({target:'rec-project',scores:[3,4,5],reasons:['','','']},'open',[],eligible,ROUND).length")===1);
ok(f.run("GlowLogic.validate({target:'rec-project',scores:[3,4,5],reasons:['ตัวอย่างสถานการณ์','','']},'open',[],eligible,ROUND).length")===0);
f.run('save()');
ok([...f.storage.values()].every(value=>!value.includes('test-session-token')&&!value.includes('1111111111111')));
f.run('signOut()');
ok(f.run('directory.people.length')===0 && f.run('eligible.length')===0 && f.run('GlowLogin.profile()')===null);
await assert.rejects(f.context.GlowLogin.employees(),/session_expired/);checks++;

for(const mode of ['error','unauthorized','no-session','invalid','empty']){
  const g=fixture(mode);await g.login();g.run("go('rate')");await tick();
  if(mode==='empty'){
    ok(g.run('directory.status')==='ready' && g.q('#app').innerHTML.includes('ยังไม่มีรายชื่อผู้ร่วมงานที่พร้อมให้ประเมิน'));
  }else if(mode==='unauthorized'||mode==='no-session'){
    ok(g.run('GlowLogin.active()')===false && g.run('eligible.length')===0);
    ok(g.q('#app').innerHTML.includes('id="employee-login"'));
    ok(g.q('#app').innerHTML.includes(mode==='unauthorized'?'เซสชันหมดอายุแล้ว':'เชื่อมต่อบัญชี'));
  }else{
    ok(g.run('directory.status')==='error' && g.run('eligible.length')===0);
    ok(g.q('#app').innerHTML.includes('retry-directory'));
  }
  ok(!g.run('targetPicker()').includes('พลอย'));
}

const expired=fixture();await expired.login();expired.expire();
await assert.rejects(expired.context.GlowLogin.employees(),/session_expired/);checks++;
ok(expired.calls.length===2);

const pending=fixture('pending');await pending.login();pending.run("go('rate')");
await tick();pending.run('signOut()');pending.finish();await tick();
ok(pending.run('directory.status')==='idle' && pending.run('eligible.length')===0);
ok(!pending.q('#app').innerHTML.includes('โครงการใหม่'));


for(const mode of ['save-error','invalid-receipt']){
 const g=fixture(mode);await g.login();await tick();g.run("go('rate')");await tick();g.run("start('rec-hr');form.scores=[4,4,5];stage='review';showDialog=content=>{globalThis.savedDialog=content}");g.run('render()');
 const count=g.run('db.records.length');await g.q('#submit-form').handlers.click();
 ok(g.run('form')!==null && g.run('typeof savedDialog')==='undefined');
 ok(g.run('db.records.length')===count && g.run('Scores.history().length')===0);
 ok(g.q('#app').innerHTML.includes('ยังยืนยัน'));
}
const noApi=fixture('api-missing');await noApi.login();await tick();
ok(noApi.run('Scores.status()')==='error');ok(noApi.q('#app').innerHTML.includes('รอแสดงผลประเมิน'));
ok(!noApi.q('#app').innerHTML.includes('ยังโหลดคะแนนไม่ได้')&&!noApi.q('#app').innerHTML.includes('โหลดคะแนนล่าสุด'));
ok(!noApi.q('#app').innerHTML.includes('ยังไม่ได้รับการประเมิน'));
for(const mode of ['score-setup-required','score-private','api-missing']){
 const g=fixture(mode);await g.login();await tick();g.run("go('rate')");await tick();
 ok(g.run("directory.status==='ready'&&!Scores.ready()"));
 const picker=g.run("targetPicker('Project Co')");
 ok(picker.includes('โครงการใหม่')&&picker.includes('<option value="Project Co"'));
 ok(!/<select id="department"[^>]*\sdisabled/.test(picker)&&!/<select id="target-person"[^>]*\sdisabled/.test(picker));
 ok(!g.q('#app').innerHTML.includes("class='demo'>BASE"));
 g.q('#department').value='Project Co';await g.q('#department').handlers.change({target:g.q('#department')});g.q('#target-person').value='rec-project';
 await g.q('#target-person').handlers.change({target:g.q('#target-person')});
 ok(!beginDisabled(g));
 g.run('render()');
 ok(g.q('#app').innerHTML.includes('value="rec-project" selected'));
 await g.q('#begin-person').handlers.click();ok(g.run('form.target')==='rec-project');
 g.run("form.scores=[4,4,5];stage='review';render()");
 await g.q('#submit-form').handlers.click();
 ok(g.run('form.target')==='rec-project'&&g.q('#app').innerHTML.includes('ยังส่งไม่สำเร็จ กรุณาลองอีกครั้ง'));
 ok(!g.q('#app').innerHTML.includes('ตั้งค่าไม่ครบ')&&!g.q('#app').innerHTML.includes('ติดต่อผู้ดูแลระบบ'));
 ok(g.run("db.drafts['rec-project'].scores.join(',')")==='4,4,5');
 ok(!g.q('#app').innerHTML.includes('HR ต้องเตรียมคอลัมน์')&&!g.q('#app').innerHTML.includes('ลองโหลดคะแนนอีกครั้ง'));
 ok(!g.calls.some(call=>call.url.endsWith('/assessments')));
}
// A schema failure that arrives only after POST also stays out of employee copy and saves the draft.
const lateSetup=fixture('save-setup-required');await lateSetup.login();await tick();lateSetup.run("go('rate')");await tick();lateSetup.run("start('rec-project');form.scores=[5,5,5];stage='review';render()");
await lateSetup.q('#submit-form').handlers.click();
ok(lateSetup.q('#app').innerHTML.includes('ยังส่งไม่สำเร็จ กรุณาลองอีกครั้ง'));
ok(!lateSetup.q('#app').innerHTML.includes('ตั้งค่าไม่ครบ')&&!lateSetup.q('#app').innerHTML.includes('ติดต่อผู้ดูแลระบบ'));
ok(lateSetup.run("db.drafts['rec-project'].scores.join(',')")==='5,5,5');
ok(lateSetup.run('Scores.history().length')===0&&lateSetup.run('form.target')==='rec-project');

// HR sees the actual missing names; incompatible fields block preparation before mutation.
const hrSetup=fixture('hr-setup-required');await hrSetup.login();await tick();hrSetup.run("go('admin')");
ok(hrSetup.q('#app').innerHTML.includes('ตั้งค่าคะแนน'));
ok(hrSetup.q('#app').innerHTML.includes('คอลัมน์ที่ยังขาด (1)')&&hrSetup.q('#app').innerHTML.includes('CC_รหัสผู้รับ'));
ok(hrSetup.q('#app').innerHTML.includes('tblScores')&&hrSetup.q('#app').innerHTML.includes('id="setup-live-scores"'));
await hrSetup.q('#setup-live-scores').handlers.click({currentTarget:hrSetup.q('#setup-live-scores')});
ok(hrSetup.q('#app').innerHTML.includes('เชื่อมตารางคะแนนแล้ว')&&hrSetup.run('Scores.ready()'));
ok(hrSetup.calls.filter(call=>call.url.endsWith('/hr/setup')).length===1);
const wrongTypeUI=fixture('hr-wrong-type');await wrongTypeUI.login();await tick();wrongTypeUI.run("go('admin')");
ok(wrongTypeUI.q('#app').innerHTML.includes('ชนิดข้อมูลไม่รองรับ')&&wrongTypeUI.q('#app').innerHTML.includes('คะแนนดาว'));
ok(!wrongTypeUI.q('#app').innerHTML.includes('id="setup-live-scores"')&&!wrongTypeUI.run('Scores.ready()'));
const staleSetup=fixture('hr-setup-stale');await staleSetup.login();await tick();staleSetup.run("go('admin')");
await staleSetup.q('#setup-live-scores').handlers.click({currentTarget:staleSetup.q('#setup-live-scores')});
ok(!staleSetup.run('Scores.ready()')&&staleSetup.q('#toast').textContent.includes('ยังตรวจยืนยัน'));

const race=fixture('pending-save');await race.login();await tick();race.run("go('rate')");await tick();race.run("start('rec-hr');form.scores=[4,4,5];stage='review';showDialog=content=>{globalThis.savedDialog=content}");race.run('render()');
const waiting=race.q('#submit-form').handlers.click();await tick();await race.q('#submit-form').handlers.click();
ok(race.calls.filter(c=>c.url.endsWith('/assessments')).length===1);
race.run('signOut()');race.finish();await waiting;ok(race.run('Scores.status()')==='idle');ok(race.run('typeof savedDialog')==='undefined');

// A valid selection enables the form; mismatched, self, completed and closed targets stay blocked.
const selection=fixture();await selection.login();await tick();selection.run("go('rate')");await tick();
selection.q('#department').value='Project Co';await selection.q('#department').handlers.change({target:selection.q('#department')});selection.q('#target-person').value='rec-hr';
await selection.q('#target-person').handlers.change({target:selection.q('#target-person')});ok(beginDisabled(selection));
selection.q('#target-person').value='rec-project';await selection.q('#target-person').handlers.change({target:selection.q('#target-person')});ok(!beginDisabled(selection));
selection.run('render()');ok(selection.q('#app').innerHTML.includes('value="rec-project" selected'));
selection.run("start('rec-self')");ok(selection.run('form')===null);
selection.run("db.notWorked.push('rec-project');start('rec-project')");ok(selection.run('form')===null);
const closed=fixture('closed-round');await closed.login();await tick();closed.run("go('rate')");await tick();closed.run("start('rec-project')");ok(closed.run('form')===null);

// Catch completed assessments at selection, including history updated since login.
for(const mode of ['already-assessed','late-history']){
 const g=fixture(mode);await g.login();await tick();g.run("go('rate')");await tick();
 g.q('#department').value='Project Co';await g.q('#department').handlers.change({target:g.q('#department')});
 g.q('#context').value='โปรเจกต์ที่กรอกไว้';g.q('#context').handlers.input({target:g.q('#context')});
 g.q('#target-person').value='rec-project';await g.q('#target-person').handlers.change({target:g.q('#target-person')});
 ok(g.q('#app').innerHTML.includes('คุณส่งการประเมินคนนี้แล้วในรอบนี้')&&beginDisabled(g));
 const selectedPage=g.q('#app').innerHTML;
 ok(selectedPage.indexOf('<h2>เลือกผู้ร่วมงาน</h2>')<selectedPage.indexOf('id="target-status"')&&selectedPage.indexOf('id="target-status"')<selectedPage.indexOf('id="department"'));
 ok(!/<div id="target-status"[^>]*hidden/.test(selectedPage)&&selectedPage.includes('โครงการใหม่ · Project Co'));
 ok(g.q('#target-status').focused&&g.q('#target-status').scrolled);
 ok(g.q('#app').innerHTML.includes('โปรเจกต์ที่กรอกไว้')&&g.run('form')===null);
 ok(!/<option value="rec-project"[^>]*disabled/.test(g.q('#app').innerHTML));
 await g.q('#begin-person').handlers.click();ok(g.run('form')===null);
 ok(!g.calls.some(c=>c.url.endsWith('/assessments')));
 g.q('#department').value='HR & Admin';await g.q('#department').handlers.change({target:g.q('#department')});
 g.q('#target-person').value='rec-hr';await g.q('#target-person').handlers.change({target:g.q('#target-person')});
 ok(!beginDisabled(g)&&!g.q('#app').innerHTML.includes('คุณส่งการประเมินคนนี้แล้วในรอบนี้'));
 await g.q('#begin-person').handlers.click();ok(g.run('form.target')==='rec-hr'&&g.run('form.context')==='โปรเจกต์ที่กรอกไว้');
}
// Block starting during the fresh read, and discard a late selection check after navigating away.
const checking=fixture('pending-history');await checking.login();await tick();checking.run("go('rate')");await tick();
checking.q('#department').value='Project Co';await checking.q('#department').handlers.change({target:checking.q('#department')});
checking.q('#target-person').value='rec-project';const checkPending=checking.q('#target-person').handlers.change({target:checking.q('#target-person')});await tick();
ok(checking.run('pickerChecking')&&beginDisabled(checking)&&checking.q('#app').innerHTML.includes('กำลังตรวจสอบประวัติการประเมิน'));
await checking.q('#begin-person').handlers.click();ok(checking.run('form')===null);
checking.run("go('home')");checking.finish();await checkPending;
ok(checking.run("page==='home'&&!pickerChecking&&form===null&&pickerTarget===''")&&!checking.q('#app').innerHTML.includes('id="target-person"'));

// Expired sessions leave the authenticated screen and retain the current account's draft.
const draft=fixture();await draft.login();await tick();draft.run("go('rate')");await tick();draft.run("start('rec-project');form.scores=[4,4,5]");draft.q('#context').value='งานที่กำลังกรอก';draft.expire();
await assert.rejects(draft.context.GlowLogin.request('/me/state'),error=>error.code==='session_expired');checks++;
ok(!draft.run('GlowLogin.active()')&&draft.q('#app').innerHTML.includes('เซสชันหมดอายุแล้ว'));
ok(!draft.q('#app').innerHTML.includes('HR ADMIN PORTAL')&&!draft.q('#app').innerHTML.includes('ประวัติการประเมิน'));
const savedDraft=JSON.parse(draft.storage.get('cubic-connect-prototype-v2:employee:rec-self')).drafts['rec-project'];
ok(savedDraft.context==='งานที่กำลังกรอก'&&savedDraft.scores.join(',')==='4,4,5');
await draft.login();await tick();draft.run("go('rate')");await tick();draft.run("start('rec-project')");ok(draft.run('form.context')==='งานที่กำลังกรอก');
const denied=fixture('score-unauthorized');await denied.login();await tick();ok(!denied.run('GlowLogin.active()')&&denied.q('#app').innerHTML.includes('เซสชันหมดอายุแล้ว'));

// Rendered greetings follow Bangkok time even when the host clock uses UTC.
for(const [iso,text] of [
 ['2026-11-04T17:00:00Z','ยังไม่นอนอีกเหรอ'],['2026-11-04T22:00:00Z','อรุณสวัสดิ์'],
 ['2026-11-05T04:00:00Z','สวัสดีตอนเที่ยง'],['2026-11-05T07:00:00Z','สวัสดีตอนบ่าย'],
 ['2026-11-05T10:00:00Z','สวัสดีตอนเย็น'],['2026-11-05T11:00:00Z','ได้เวลาเลิกงานแล้ว กลับบ้านกัน'],
 ['2026-11-05T13:00:00Z','วันนี้เหนื่อยไหม'],['2026-11-05T16:00:00Z','ยังไม่นอนอีกเหรอ']
]){const g=fixture();g.setTime(iso);await g.login();await tick();ok(g.q('#app').innerHTML.includes(text+' ผู้ทดสอบ'));}
const greetingRefresh=fixture();greetingRefresh.setTime('2026-11-05T10:59:00Z');await greetingRefresh.login();await tick();
greetingRefresh.setTime('2026-11-05T11:01:00Z');greetingRefresh.run("document.visibilityState='visible';refreshScoresWhenVisible()");await tick();ok(greetingRefresh.q('#app').innerHTML.includes('ได้เวลาเลิกงานแล้ว กลับบ้านกัน ผู้ทดสอบ'));
const escapedGreeting=fixture('nickname-escape');await escapedGreeting.login();await tick();ok(escapedGreeting.q('#app').innerHTML.includes('&lt;img')&&!escapedGreeting.q('#app').innerHTML.includes('<img src=x'));
const instant=fixture('instant-feedback');await instant.login();await tick();
ok(instant.q('#app').innerHTML.includes('ฟีดแบ็กที่ได้รับ')&&instant.q('#app').innerHTML.includes('★</span> 4 / 5')&&instant.q('#app').innerHTML.includes('★</span> 5 / 5'));
ok(instant.run('Scores.data().summary.overall')===null);
ok(!instant.calls.some(c=>c.url.includes('/hr/')));
instant.run("document.visibilityState='visible';refreshScoresWhenVisible()");
ok(instant.run("Scores.status()==='ready'")&&instant.q('#app').innerHTML.includes('★</span> 5 / 5'));
await tick();
ok(instant.calls.filter(c=>c.url.endsWith('/me/state')).length===2);

const receiptHistory=fixture('history-read-fails');await receiptHistory.login();await tick();
receiptHistory.run("go('rate')");await tick();
receiptHistory.run("start('rec-project');form.scores=[4,5,4];stage='review';showDialog=content=>{globalThis.savedDialog=content};render()");
await receiptHistory.q('#submit-form').handlers.click();
ok(receiptHistory.run("Scores.status()==='error'&&Scores.history().length===1&&Scores.history()[0].target==='rec-project'"));
ok(receiptHistory.run('savedDialog').includes('ดูประวัติการประเมิน'));
receiptHistory.run("go('results')");
ok(receiptHistory.q('#app').innerHTML.includes('ผู้ทดสอบรับ')&&receiptHistory.q('#app').innerHTML.includes('ส่งแล้ว')&&receiptHistory.q('#app').innerHTML.includes('history-details" open'));
ok(!receiptHistory.q('#app').innerHTML.includes('simulated read failure'));
receiptHistory.run('signOut()');
ok(receiptHistory.run('Scores.history().length')===0);
console.log(`Directory and scores UI: ${checks} checks passed with synthetic responses; no live employee data used.`);

