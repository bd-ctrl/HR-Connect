// Employee login UI. Employee verification is handled by the Cloudflare Worker.
(function(){
 // Verify the ID through the Cloudflare Worker. Keep the ID only in the request body.
 const API_BASE='https://cubic-connect-api.ba-bd5.workers.dev';
 const API_URL=API_BASE+'/login';
 let signedIn=false,profile=null,generation=0,sessionToken='',sessionExpiresAt=0,expiredHandler=null,loginNotice='';
 function expireSession(code){if(signedIn)expiredHandler?.(code);sessionToken='';sessionExpiresAt=0;}
 function checkSession(){
  if(!signedIn)return false;
  const code=!sessionToken?'directory_session_missing':Date.now()>=sessionExpiresAt?'session_expired':'';
  if(code){expireSession(code);return false;}return true;
 }
 const verifyEmployee=async (loginCode,role)=>{
  const body=loginCode.startsWith('00009')?{admin_code:loginCode}:{national_id:loginCode};
  if(role)body.role=role;
  const response=await fetch(API_URL,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(15000)});
  let data;try{data=await response.json()}catch{throw Error('invalid_response')}
  if(!response.ok||data?.ok===false)throw Error(data?.message||data?.error||'not_found');
  if(!role&&data?.ok===true&&data.role_selection_required===true&&Array.isArray(data.roles)&&data.roles.includes('employee')&&data.roles.includes('admin')){
   return {chooseRole:true};
  }
  if(data?.ok!==true||!data.employee)throw Error('invalid_response');
  if(role&&(data.employee.role!==role||!data.session_token))throw Error('invalid_response');
  return {employee:data.employee,token:typeof data.session_token==='string'?data.session_token:'',expiresIn:Number(data.expires_in)||900};
 };
 // Keep the bearer token in this closure; do not persist it or the ID in browser storage.
 async function employees(){
  if(!signedIn)throw Error('session_expired');
  if(!sessionToken){expireSession('directory_session_missing');throw Error('directory_session_missing');}
  if(Date.now()>=sessionExpiresAt){expireSession('session_expired');throw Error('session_expired');}
  const g=generation;
  let response;
  try{response=await fetch(API_BASE+'/employees',{method:'GET',mode:'cors',credentials:'omit',headers:{Authorization:'Bearer '+sessionToken},cache:'no-store',signal:AbortSignal.timeout(15000)})}
  catch(err){if(err.name==='AbortError'||err.name==='TimeoutError')throw Error('directory_timeout');throw Error('directory_unavailable')}
  if(g!==generation||!signedIn)throw Error('session_changed');
  if(response.status===401){expireSession('session_expired');throw Error('session_expired')}
  let data;try{data=await response.json()}catch{throw Error('invalid_directory')}
  if(!response.ok||data?.ok!==true)throw Error('directory_unavailable');
  if(!Array.isArray(data.employees))throw Error('invalid_directory');
  return data;
 }
 async function request(path,options={}){
  if(!signedIn)throw Object.assign(Error('กรุณาเข้าสู่ระบบใหม่'),{code:'session_expired'});
  if(!sessionToken){expireSession('directory_session_missing');throw Object.assign(Error('กรุณาเข้าสู่ระบบใหม่'),{code:'directory_session_missing'});}
  if(Date.now()>=sessionExpiresAt){expireSession('session_expired');throw Object.assign(Error('กรุณาเข้าสู่ระบบใหม่'),{code:'session_expired'});}
  const g=generation,method=options.method||'GET';let response;
  try{response=await fetch(API_BASE+path,{method,mode:'cors',credentials:'omit',headers:{Authorization:'Bearer '+sessionToken,...(options.body?{'Content-Type':'application/json'}:{})},...(options.body?{body:JSON.stringify(options.body)}:{}),cache:'no-store',signal:AbortSignal.timeout(method==='GET'?30000:45000)})}
  catch(error){throw Object.assign(Error(error.name==='TimeoutError'||error.name==='AbortError'?'ยังยืนยันผลการเชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง':'เชื่อมต่อระบบคะแนนไม่ได้ กรุณาลองอีกครั้ง'),{code:'score_connection_failed'})}
  if(g!==generation||!signedIn)throw Object.assign(Error('บัญชีที่ใช้งานเปลี่ยนแล้ว'),{code:'session_changed'});
  if(response.status===401){expireSession('session_expired');throw Object.assign(Error('กรุณาเข้าสู่ระบบใหม่'),{code:'session_expired'})}
  let data;try{data=await response.json()}catch{throw Object.assign(Error('ระบบคะแนนตอบกลับไม่ถูกต้อง'),{code:'invalid_score_response'})}
  if(!response.ok||data?.ok!==true)throw Object.assign(Error(response.status===404?'Worker ยังไม่ได้ติดตั้ง API คะแนนชุดใหม่':data?.message||'โหลดข้อมูลคะแนนไม่สำเร็จ'),{code:response.status===404?'score_api_missing':data?.error||'score_error',status:response.status});
  return data;
 }
 const messages={network_timeout:"เชื่อมต่อใช้เวลานานเกินไป กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่",invalid_national_id:"กรุณาตรวจสอบข้อมูลที่กรอก",not_found:"ไม่สามารถยืนยันข้อมูลได้ กรุณาตรวจสอบหรือติดต่อ HR",connection_unavailable:"ระบบตรวจสอบพนักงานขัดข้อง กรุณาลองใหม่ภายหลัง",invalid_response:"Worker ส่งข้อมูลกลับมาไม่ถูกต้อง กรุณาตรวจการตอบกลับของ API",worker_unreachable:"เชื่อมต่อ Worker ไม่ได้ กรุณาตรวจ URL และการตั้งค่า CORS"};
 function loginError(error){
  if(error.name==='TimeoutError'||error.name==='AbortError')return messages.network_timeout;
  if(error.name==='TypeError')return messages.worker_unreachable;
  return messages[error.message]||error.message||messages.connection_unavailable;
 }
 function completeLogin({employee,token,expiresIn},onLogin){
  const role=String(employee.role||'').toLowerCase()==='admin'?'admin':'employee';
  profile={id:String(employee.id||''),nickname:String(employee.nickname||employee.name||''),department:String(employee.department||''),role};
  sessionToken=token;sessionExpiresAt=Date.now()+Math.max(0,expiresIn)*1000;
  signedIn=true;loginNotice='';onLogin(profile.role);window.scrollTo(0,0);
 }
 function renderRolePicker(root,code,onLogin){
  root.innerHTML=`<main class="login-page"><section class="login-card role-picker-card" aria-labelledby="login-heading">
    <div class="login-brand"><div class="logo">CUBIC CONNECT<span>✦</span></div></div>
    <h1 id="login-heading" tabindex="-1">เลือกรูปแบบการเข้าสู่ระบบ</h1>
    <div class="role-picker-actions">
     <button type="button" class="secondary" id="role-employee">เข้าสู่ระบบแบบพนักงาน</button>
     <button type="button" class="primary" id="role-admin">เข้าสู่ระบบแบบแอดมิน</button>
    </div>
    <p id="role-picker-error" class="error" role="alert" hidden></p>
    <button type="button" class="ghost" id="role-back">กลับไปหน้าเข้าสู่ระบบ</button>
   </section></main>`;
  document.querySelector('#login-heading')?.focus();
  const employee=document.querySelector('#role-employee'),admin=document.querySelector('#role-admin'),back=document.querySelector('#role-back');
  const error=document.querySelector('#role-picker-error');
  back.onclick=()=>{generation++;code='';render(onLogin);document.querySelector('#employee-code')?.focus();};
  async function choose(role){
   const g=++generation;
   employee.disabled=admin.disabled=true;error.hidden=true;
   try{
    const result=await verifyEmployee(code,role);
    if(g!==generation)return;
    code='';completeLogin(result,onLogin);
   }catch(err){
    if(g!==generation)return;
    error.textContent=loginError(err);error.hidden=false;
   }finally{
    if(g===generation)employee.disabled=admin.disabled=false;
   }
  }
  employee.onclick=()=>void choose('employee');
  admin.onclick=()=>void choose('admin');
 }
 function render(onLogin){
  const root=document.querySelector('#app');
  root.innerHTML=`<main class="login-page"><section class="login-card" aria-labelledby="login-heading"><div class="login-brand"><div class="logo">CUBIC CONNECT<span>✦</span></div><div class="brand-caption">SUITCUBE · PEOPLE & CULTURE</div></div><div class="login-mascot"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/rating-4.png"><img src="assets/rating-4.gif" alt="น้องดาวยิ้มต้อนรับ" width="170" height="170"></picture></div><div class="eyebrow">WELCOME TO CUBIC CONNECT</div><h1 id="login-heading">เข้าสู่ระบบประเมิน</h1><p class="muted">ทุกความคิดเห็น ช่วยให้เราเติบโตไปด้วยกัน</p>${loginNotice?`<p class="notice session-notice" role="status">${loginNotice}</p>`:''}<form id="employee-login" novalidate><div class="field login-code-field"><label class="sr-only" for="employee-code">เลขบัตรประชาชน</label><div class="login-code-row"><input id="employee-code" name="employee-code" type="text" inputmode="numeric" autocomplete="username" placeholder="เลขบัตรประชาชน" maxlength="13" pattern="[0-9]{13}" aria-describedby="employee-help employee-error" required><button id="employee-submit" class="login-submit star-login" type="submit" aria-label="เข้าสู่ระบบ" title="เข้าสู่ระบบ"><svg class="login-star-shape" viewBox="0 0 180 172" aria-hidden="true"><path d="M83 9Q90 -1 97 9L117 46Q120 51 126 52L168 58Q181 60 171 71L142 100Q138 104 139 111L146 153Q149 167 136 161L96 141Q90 138 84 141L44 161Q31 167 34 153L41 111Q42 104 38 100L9 71Q-1 60 12 58L54 52Q60 51 63 46Z"/></svg><svg class="login-keyhole" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 10a4 4 0 1 0-6 3.46L9 20h6l-1-6.54A4 4 0 0 0 16 10Z"/></svg></button></div><div id="employee-help" class="sr-only" aria-live="polite"></div></div><div id="employee-error" class="error" role="alert" hidden></div></form><a href="workflow-preview.html" class="secondary" style="display:block;margin-top:20px;text-align:center;text-decoration:none">ดูตัวอย่างฟีดแบ็กและ HR</a><p class="muted" style="font-size:11px;margin-top:8px">ข้อมูลสมมติ · ไม่ต้องกรอกเลขบัตรเพื่อดูตัวอย่าง</p></section><p class="login-bottom">SUITCUBE · พื้นที่สำหรับคำขอบคุณ และการเติบโตร่วมกัน</p></main>`;
  const field=document.querySelector('#employee-code'),error=document.querySelector('#employee-error');
  field.addEventListener('input',()=>{field.value=field.value.replace(/[^0-9]/g,'').slice(0,13);error.hidden=true;field.removeAttribute('aria-invalid')});
  document.querySelector('#employee-login').onsubmit=async e=>{
   e.preventDefault();const value=field.value.trim(),button=document.querySelector('#employee-submit'),help=document.querySelector('#employee-help');
   if(!/^[0-9]{13}$/.test(value)){error.textContent=messages.invalid_national_id;error.hidden=false;field.setAttribute('aria-invalid','true');field.focus();return}
   const g=++generation;button.disabled=true;field.disabled=true;error.hidden=true;help.textContent='กำลังตรวจสอบข้อมูลกับ Lark…';
   try{
    const result=await verifyEmployee(value);field.value='';
    if(g!==generation)return;
    if(result.chooseRole){renderRolePicker(root,value,onLogin);return;}
    completeLogin(result,onLogin);
   }catch(err){
    if(g===generation){error.textContent=loginError(err);error.hidden=false;field.value=''}
   }finally{
    if(document.querySelector('#employee-submit')===button){button.disabled=false;field.disabled=false;help.textContent=''}
   }
  };

 }
 window.GlowLogin={request,active:()=>signedIn,profile:()=>profile,render,employees,checkSession,onExpired:handler=>{expiredHandler=handler;},logout:reason=>{generation++;signedIn=false;profile=null;sessionToken='';sessionExpiresAt=0;loginNotice=reason==='session_expired'?'เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้ง':reason==='directory_session_missing'?'กรุณาเข้าสู่ระบบอีกครั้งเพื่อเชื่อมต่อบัญชี':'';}};
})();

