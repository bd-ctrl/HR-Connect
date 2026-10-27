import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {loginAPI} from './lib/login-api.js';
const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')))sql.exec(readFileSync('drizzle/'+f,'utf8'));
const db={prepare(query){return{bind(...args){return{first:async()=>sql.prepare(query).get(...args)||null,run:async()=>({meta:sql.prepare(query).run(...args)})}}}},async batch(statements){return Promise.all(statements.map(s=>s.run()))}};
const env={DB:db,SITE_ORIGIN:'https://test.invalid',LARK_LOGIN_WEBHOOK_URL:'https://lark.invalid',LARK_CALLBACK_ACCESS_TOKEN:'test-only'};let payload;
const lark=async(url,options)=>{assert.equal(url,'https://lark.invalid');payload=JSON.parse(options.body);return new Response('{}')};
const req=(path,{data,method='POST',uid='owner',cookie,reference,origin='https://test.invalid'}={})=>new Request('https://test.invalid'+path,{method,headers:{...(uid?{'oai-authenticated-user-id':uid}:{}),...(origin?{origin}:{}),...(cookie?{cookie}:{}),...(reference?{'X-Cubic-Login-Reference':reference}:{}),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
const call=(path,opts)=>loginAPI(req(path,opts),env,lark);let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
eq((await call('/api/login',{data:{national_id:'abc'}})).status,400);eq((await call('/api/login',{data:{national_id:'0000000000000'},origin:'https://attacker.invalid'})).status,403);eq((await call('/api/login',{data:{national_id:'0000000000000'},uid:null})).status,401);
let missing=await call('/api/login/status');eq(missing.status,409);eq((await missing.json()).error,'login_reference_missing');
let r=await call('/api/login',{data:{national_id:'0000000000000'}});eq(r.status,202);const ch=r.headers.get('set-cookie').split(';')[0];eq(payload.national_id,'0000000000000');eq((await call('/api/login/status',{cookie:ch})).status,202);eq((await call('/api/login/status',{cookie:ch,uid:'other'})).status,409);
const result={request_id:payload.request_id,callback_token:payload.callback_token,matches:[{employee_id:'synthetic-record',nickname:'ดาวทดสอบ'}]};eq((await call('/api/lark/login-result',{data:{...result,callback_token:'a'.repeat(64)},uid:null,origin:null})).status,403);eq((await call('/api/lark/login-result',{data:result,uid:null,origin:null})).status,200);eq((await call('/api/lark/login-result',{data:result,uid:null,origin:null})).status,403);
r=await call('/api/login/status',{cookie:ch});eq(r.status,200);eq((await r.clone().json()).employee.nickname,'ดาวทดสอบ');const session=r.headers.get('set-cookie').split(';')[0];assert(r.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Strict'));checks++;
eq((await call('/api/login/status',{cookie:ch})).status,409);eq((await (await call('/api/session',{method:'GET',cookie:session})).json()).authenticated,true);eq((await (await call('/api/session',{method:'GET',cookie:session,uid:'other'})).json()).authenticated,false);
await call('/api/logout',{cookie:session});eq((await (await call('/api/session',{method:'GET',cookie:session})).json()).authenticated,false);
// A per-attempt memory reference works without challenge cookies and remains owner/capability bound.
r=await call('/api/login',{data:{national_id:'0000000000000'},uid:'no-cookie-owner'});const ref=(await r.json()).attempt_reference;
eq((await call('/api/login/status',{reference:ref,uid:'no-cookie-owner'})).status,202);
eq((await call('/api/login/status',{reference:ref,uid:'other'})).status,409);
eq((await call('/api/login/status',{reference:ref.slice(0,-1)+'z',uid:'no-cookie-owner'})).status,409);
await call('/api/lark/login-result',{data:{request_id:payload.request_id,callback_token:payload.callback_token,matches:[{employee_id:'test-no-cookie',nickname:'ดาวทดสอบ'}]},uid:null,origin:null});
r=await call('/api/login/status',{reference:ref,uid:'no-cookie-owner'});eq(r.status,200);eq((await r.json()).employee.nickname,'ดาวทดสอบ');
eq((await call('/api/login/status',{reference:ref,uid:'no-cookie-owner'})).status,409);
// Verified malformed result fails visibly; it must not leave a valid attempt pending.
r=await call('/api/login',{data:{national_id:'0000000000000'},uid:'malformed-owner'});const badCookie=r.headers.get('set-cookie').split(';')[0];
eq((await call('/api/lark/login-result',{data:{request_id:payload.request_id,callback_token:payload.callback_token},uid:null,origin:null})).status,400);
const badStatus=await call('/api/login/status',{cookie:badCookie,uid:'malformed-owner'});eq(badStatus.status,422);eq((await badStatus.json()).error,'callback_invalid');
for(const matches of [[],[{employee_id:'a',nickname:'A'},{employee_id:'b',nickname:'B'}]]){r=await call('/api/login',{data:{national_id:'0000000000000'}});const c=r.headers.get('set-cookie').split(';')[0];await call('/api/lark/login-result',{data:{request_id:payload.request_id,callback_token:payload.callback_token,matches},uid:null,origin:null});eq((await call('/api/login/status',{cookie:c})).status,401)}
r=await call('/api/login',{data:{national_id:'0000000000000'}});const expired=r.headers.get('set-cookie').split(';')[0];sql.prepare('UPDATE login_challenges SET expires_at = 0 WHERE id = ?').run(payload.request_id);eq((await call('/api/login/status',{cookie:expired})).status,408);eq((await call('/api/lark/login-result',{data:{request_id:payload.request_id,callback_token:payload.callback_token,matches:[]},uid:null,origin:null})).status,403);
await call('/api/login',{data:{national_id:'0000000000000'}});await call('/api/login',{data:{national_id:'0000000000000'}});eq((await call('/api/login',{data:{national_id:'0000000000000'}})).status,429);
assert(!JSON.stringify(sql.prepare('SELECT * FROM login_challenges').all()).includes('0000000000000'));checks++;console.log(checks+' login API checks passed (synthetic fixtures; live Lark not exercised)');
