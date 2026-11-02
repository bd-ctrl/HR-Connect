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
      setAttribute(){},removeAttribute(){},focus(){}
    });
    return elements.get(selector);
  };
  let clock = Date.now(), resolveDirectory;
  class TestDate extends Date {static now(){return clock;}}
  const context = {
    document:{querySelector:q,querySelectorAll:()=>[],addEventListener(){}},
    window:{scrollTo(){}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    matchMedia:()=>({matches:true}),Date:TestDate,
    AbortSignal,Response,structuredClone,setTimeout:()=>0,clearTimeout(){},
    fetch:async (url, options) => {
      calls.push({url,options});
      if(url.endsWith('/login'))return Response.json({
        ok:true,employee:{id:'rec-self',nickname:'ผู้ทดสอบ',department:'BA',role:'employee'},
        ...(mode==='no-session'?{}:{session_token:'test-session-token',expires_in:900})
      });
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
    finish(){resolveDirectory?.();}
  };
}

const tick=()=>new Promise(resolve=>setImmediate(resolve));
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
f.run('save()');
ok([...f.storage.values()].every(value=>!value.includes('test-session-token')&&!value.includes('1111111111111')));
f.run('signOut()');
ok(f.run('directory.people.length')===0 && f.run('eligible.length')===0 && f.run('GlowLogin.profile()')===null);
await assert.rejects(f.context.GlowLogin.employees(),/session_expired/);checks++;

for(const mode of ['error','unauthorized','no-session','invalid','empty']){
  const g=fixture(mode);await g.login();g.run("go('rate')");await tick();
  if(mode==='empty'){
    ok(g.run('directory.status')==='ready' && g.q('#app').innerHTML.includes('ยังไม่มีรายชื่อผู้ร่วมงานที่พร้อมให้ประเมิน'));
  }else{
    ok(g.run('directory.status')==='error' && g.run('eligible.length')===0);
    ok(g.q('#app').innerHTML.includes(mode==='unauthorized'||mode==='no-session'?'directory-relogin':'retry-directory'));
  }
  ok(!g.run('targetPicker()').includes('พลอย'));
}

const expired=fixture();await expired.login();expired.expire();
await assert.rejects(expired.context.GlowLogin.employees(),/session_expired/);checks++;
ok(expired.calls.length===1);

const pending=fixture('pending');await pending.login();pending.run("go('rate')");
await tick();pending.run('signOut()');pending.finish();await tick();
ok(pending.run('directory.status')==='idle' && pending.run('eligible.length')===0);
ok(!pending.q('#app').innerHTML.includes('โครงการใหม่'));

console.log(`Directory UI: ${checks} checks passed with synthetic responses; no live employee data used.`);
