// Employee login UI. Employee verification is handled by the Cloudflare Worker.
(function(){
 // Verify the ID through the Cloudflare Worker. Keep the ID only in the request body.
 const API_URL='https://cubic-connect-api.ba-bd5.workers.dev/login';
 let signedIn=false,profile=null,generation=0;
 const verifyEmployee=async loginCode=>{
  const body=loginCode.startsWith('00009')?{admin_code:loginCode}:{national_id:loginCode};
  const response=await fetch(API_URL,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(15000)});
  let data;try{data=await response.json()}catch{throw Error('invalid_response')}
  if(!response.ok||data?.ok===false)throw Error(data?.message||data?.error||'not_found');
  if(data?.ok!==true||!data.employee)throw Error('invalid_response');
  return data.employee;
 };
 const messages={network_timeout:"เชื่อมต่อใช้เวลานานเกินไป กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่",invalid_national_id:"กรุณากรอกเลขบัตรประชาชน 13 หลัก หรือรหัส HR 00009 ตามด้วยรหัสพนักงาน 8 หลัก",not_found:"ไม่สามารถยืนยันข้อมูลได้ กรุณาตรวจสอบหรือติดต่อ HR",connection_unavailable:"ระบบตรวจสอบพนักงานขัดข้อง กรุณาลองใหม่ภายหลัง",invalid_response:"Worker ส่งข้อมูลกลับมาไม่ถูกต้อง กรุณาตรวจการตอบกลับของ API",worker_unreachable:"เชื่อมต่อ Worker ไม่ได้ กรุณาตรวจ URL และการตั้งค่า CORS"};
 function render(onLogin){
  const root=document.querySelector('#app');
  root.innerHTML=`<main class="login-page"><section class="login-card" aria-labelledby="login-heading"><div class="login-brand"><div class="logo">CUBIC CONNECT<span>✦</span></div><div class="brand-caption">SUITCUBE · PEOPLE & CULTURE</div></div><div class="login-mascot"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/rating-4.png"><img src="assets/rating-4.gif" alt="น้องดาวยิ้มต้อนรับ" width="170" height="170"></picture></div><div class="eyebrow">WELCOME TO CUBIC CONNECT</div><h1 id="login-heading">เข้าสู่ระบบประเมิน</h1><p class="muted">ทุกความคิดเห็น ช่วยให้เราเติบโตไปด้วยกัน</p><form id="employee-login" novalidate><div class="field login-code-field"><label class="sr-only" for="employee-code">เลขบัตรประชาชนหรือรหัส HR</label><div class="login-code-row"><input id="employee-code" name="employee-code" type="text" inputmode="numeric" autocomplete="username" placeholder="เลขบัตรประชาชน / รหัส HR" maxlength="13" pattern="[0-9]{13}" aria-describedby="employee-help employee-error" required><button id="employee-submit" class="login-submit star-login" type="submit" aria-label="เข้าสู่ระบบ" title="เข้าสู่ระบบ"><svg class="login-star-shape" viewBox="0 0 180 172" aria-hidden="true"><path d="M83 9Q90 -1 97 9L117 46Q120 51 126 52L168 58Q181 60 171 71L142 100Q138 104 139 111L146 153Q149 167 136 161L96 141Q90 138 84 141L44 161Q31 167 34 153L41 111Q42 104 38 100L9 71Q-1 60 12 58L54 52Q60 51 63 46Z"/></svg><svg class="login-keyhole" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 10a4 4 0 1 0-6 3.46L9 20h6l-1-6.54A4 4 0 0 0 16 10Z"/></svg></button></div><div id="employee-help" class="login-help">พนักงาน: เลขบัตร 13 หลัก · HR Admin: 00009 + รหัสพนักงาน 8 หลัก</div></div><div id="employee-error" class="error" role="alert" hidden></div></form><a href="workflow-preview.html" class="secondary" style="display:block;margin-top:20px;text-align:center;text-decoration:none">ดูตัวอย่างฟีดแบ็กและ HR</a><p class="muted" style="font-size:11px;margin-top:8px">ข้อมูลสมมติ · ไม่ต้องกรอกเลขบัตรเพื่อดูตัวอย่าง</p></section><p class="login-bottom">SUITCUBE · พื้นที่สำหรับคำขอบคุณ และการเติบโตร่วมกัน</p></main>`;
  const field=document.querySelector('#employee-code'),error=document.querySelector('#employee-error');
  field.addEventListener('input',()=>{field.value=field.value.replace(/[^0-9]/g,'').slice(0,13);error.hidden=true;field.removeAttribute('aria-invalid')});
  document.querySelector('#employee-login').onsubmit=async e=>{
   e.preventDefault();const value=field.value.trim(),button=document.querySelector('#employee-submit'),help=document.querySelector('#employee-help');
   if(!/^[0-9]{13}$/.test(value)){error.textContent=messages.invalid_national_id;error.hidden=false;field.setAttribute('aria-invalid','true');field.focus();return}
   const g=++generation;button.disabled=true;field.disabled=true;error.hidden=true;help.textContent='กำลังตรวจสอบข้อมูลกับ Lark…';
   try{
    const employee=await verifyEmployee(value);field.value='';
    if(g!==generation)return;
    const isAdmin=String(employee.role||'').toLowerCase()==='admin';
    profile={nickname:isAdmin?'ADMIN':String(employee.nickname||employee.name||''),department:String(employee.department||''),role:isAdmin?'admin':'employee'};
    signedIn=true;onLogin(profile.role);window.scrollTo(0,0);
   }catch(err){
    if(g===generation){const isTimeout=err.name==='TimeoutError'||err.name==='AbortError';const message=messages[err.message];error.textContent=isTimeout?messages.network_timeout:(err.name==='TypeError'?messages.worker_unreachable:(message||err.message||messages.connection_unavailable));error.hidden=false;field.value=''}
   }finally{
    if(document.querySelector('#employee-submit')===button){button.disabled=false;field.disabled=false;help.textContent='พนักงาน: เลขบัตร 13 หลัก · HR Admin: 00009 + รหัสพนักงาน 8 หลัก'}
   }
  };

 }
 window.GlowLogin={active:()=>signedIn,profile:()=>profile,render,logout:()=>{generation++;signedIn=false;profile=null}};
})();
