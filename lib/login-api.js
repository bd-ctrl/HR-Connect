const enc=new TextEncoder();
const json=(v,status=200,extra={})=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...extra}});
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const readCookie=(r,name)=>(r.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const identity=r=>r.headers.get('oai-authenticated-user-id');
const CS='__Host-cubic_session',CH='__Host-cubic_challenge';
function sameOrigin(r,env){const origin=r.headers.get('origin');return !!origin&&(origin===new URL(r.url).origin||origin===env.SITE_ORIGIN)}
async function body(r){if(Number(r.headers.get('content-length')||0)>10000)throw Error('body');const text=await r.text();if(text.length>10000)throw Error('body');return JSON.parse(text)}
export async function loginAPI(request,env,fetcher=fetch){
 const path=new URL(request.url).pathname,method=request.method,db=env.DB,uid=identity(request),now=Date.now();
 try{
 if(path==='/api/health'&&method==='GET')return json({service:'cubic-login',configured:!!(db&&env.LARK_LOGIN_WEBHOOK_URL&&env.LARK_CALLBACK_ACCESS_TOKEN)});
 if(!db)return json({error:'connection_unavailable'},503);
 if(path==='/api/lark/login-result'&&method==='POST'){
  // Dispatch validates the service-access bearer. A per-attempt capability is also required.
  const data=await body(request);
  if(!/^[a-f0-9-]{36}$/.test(data.request_id||'')||!/^[a-f0-9]{64}$/.test(data.callback_token||''))return json({error:'invalid_result'},400);
  const row=await db.prepare('SELECT * FROM login_challenges WHERE id = ?').bind(data.request_id).first();
  if(!row||row.expires_at<now||row.state!=='pending'||row.callback_hash!==await hash(data.callback_token))return json({error:'invalid_or_expired_request'},403);
  const invalid=async()=>{await db.prepare("UPDATE login_challenges SET state = 'callback_invalid' WHERE id = ? AND state = 'pending'").bind(row.id).run();return json({error:'invalid_result'},400)};
  if(!Array.isArray(data.matches)||data.matches.length>10)return invalid();
  let match=null;if(data.matches.length===1){const item=data.matches[0];if(typeof item?.employee_id!=='string'||!item.employee_id.trim()||item.employee_id.length>100||typeof item.nickname!=='string'||!item.nickname.trim()||item.nickname.length>100)return invalid();match=item}
  const update=await db.prepare("UPDATE login_challenges SET state = ?, employee_id = ?, nickname = ? WHERE id = ? AND state = 'pending' AND expires_at > ?").bind(match?'matched':'not_found',match?.employee_id.trim()||null,match?.nickname.trim()||null,row.id,now).run();
  return update.meta.changes?json({received:true}):json({error:'already_processed'},409);
 }
 if(!uid)return json({error:'sign_in_required'},401);
 if(method==='POST'&&!sameOrigin(request,env))return json({error:'invalid_origin'},403);
 if(path==='/api/login'&&method==='POST'){
  if(!env.LARK_LOGIN_WEBHOOK_URL||!env.LARK_CALLBACK_ACCESS_TOKEN)return json({error:'connection_unavailable'},503);
  const data=await body(request);if(typeof data.national_id!=='string'||!/^\d{13}$/.test(data.national_id))return json({error:'invalid_national_id'},400);
  const count=await db.prepare('SELECT COUNT(*) AS n FROM login_challenges WHERE owner_id = ? AND created_at > ?').bind(uid,now-300000).first();if(count.n>=6)return json({error:'rate_limited'},429,{'Retry-After':'300'});
  await db.batch([db.prepare('DELETE FROM login_challenges WHERE created_at < ?').bind(now-900000),db.prepare('DELETE FROM login_sessions WHERE expires_at < ?').bind(now)]);
  const id=crypto.randomUUID(),cap=random(),browser=random();
  await db.prepare('INSERT INTO login_challenges (id,owner_id,browser_hash,callback_hash,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').bind(id,uid,await hash(browser),await hash(cap),'pending',now,now+120000).run();
  let ack;
  try{ack=await fetcher(env.LARK_LOGIN_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:id,national_id:data.national_id,callback_token:cap}),signal:AbortSignal.timeout(15000)})}catch{await db.prepare("UPDATE login_challenges SET state = 'failed' WHERE id = ?").bind(id).run();return json({error:'lark_unavailable'},503)}
  // An acknowledgement is never treated as a successful employee lookup.
  if(!ack.ok){await db.prepare("UPDATE login_challenges SET state = 'failed' WHERE id = ?").bind(id).run();return json({error:'lark_unavailable'},503)}
  return json({status:'pending',expires_in:120,attempt_reference:id+'.'+browser},202,{'Set-Cookie':cookie(CH,id+'.'+browser,120)});
 }
 if(path==='/api/login/status'&&method==='POST'){
  const reference=request.headers.get('X-Cubic-Login-Reference')||readCookie(request,CH);
  const [id,key]=reference.split('.');if(!id||!key)return json({error:'login_reference_missing'},409);
  if(!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(key))return json({error:'login_reference_invalid'},409);
  const row=await db.prepare('SELECT * FROM login_challenges WHERE id = ? AND owner_id = ? AND browser_hash = ?').bind(id,uid,await hash(key)).first();
  if(!row)return json({error:'login_reference_invalid'},409,{'Set-Cookie':cookie(CH,'',0)});
  if(row.expires_at<=now)return json({error:'expired'},408,{'Set-Cookie':cookie(CH,'',0)});
  if(row.state==='pending')return json({status:'pending'},202);
  if(row.state==='callback_invalid')return json({error:'callback_invalid'},422);
  if(row.state==='failed')return json({error:'lark_unavailable'},503);
  if(row.state==='consumed')return json({error:'login_already_used'},409);
  if(row.state!=='matched')return json({error:'not_found'},401,{'Set-Cookie':cookie(CH,'',0)});
  const claimed=await db.prepare("UPDATE login_challenges SET state = 'consumed' WHERE id = ? AND state = 'matched' RETURNING employee_id,nickname").bind(id).first();if(!claimed)return json({error:'login_already_used'},409);
  const session=random();await db.prepare('INSERT INTO login_sessions (token_hash,owner_id,employee_id,nickname,expires_at) VALUES (?,?,?,?,?)').bind(await hash(session),uid,claimed.employee_id,claimed.nickname,now+28800000).run();
  return json({status:'authenticated',employee:{id:claimed.employee_id,nickname:claimed.nickname}},200,{'Set-Cookie':cookie(CS,session,28800)});
 }
 if(path==='/api/session'&&method==='GET'){
  const token=readCookie(request,CS);if(!token)return json({authenticated:false});const row=await db.prepare('SELECT employee_id,nickname FROM login_sessions WHERE token_hash = ? AND owner_id = ? AND expires_at > ?').bind(await hash(token),uid,now).first();return json(row?{authenticated:true,employee:{id:row.employee_id,nickname:row.nickname}}:{authenticated:false});
 }
 if(path==='/api/logout'&&method==='POST'){await db.prepare('DELETE FROM login_sessions WHERE token_hash = ? AND owner_id = ?').bind(await hash(readCookie(request,CS)),uid).run();return json({ok:true},200,{'Set-Cookie':cookie(CS,'',0)});}
 return json({error:'not_found'},404);
 }catch{return json({error:'connection_unavailable'},503)}
}
