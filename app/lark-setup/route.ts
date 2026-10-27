import { env } from 'cloudflare:workers';
export const dynamic='force-dynamic';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function GET(r:Request){
 const e=env as unknown as Record<string,string>;
 if(!r.headers.get('oai-authenticated-user-id')||r.headers.get('oai-authenticated-user-email')?.toLowerCase()!==e.SETUP_OWNER_EMAIL?.toLowerCase())return new Response('Owner access required',{status:403,headers:{'Cache-Control':'no-store'}});
 const callback=e.SITE_ORIGIN+'/api/lark/login-result';
 const html=`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>CUBIC CONNECT · ตั้งค่า Lark</title><style>body{font-family:system-ui,sans-serif;background:#f6f1fc;color:#343044;margin:0;padding:24px;line-height:1.7}main{max-width:760px;margin:auto;background:white;padding:28px;border-radius:24px}h1{color:#6856ad}input,textarea{box-sizing:border-box;width:100%;padding:12px;border:1px solid #dcd5eb;border-radius:10px;font:14px monospace}label{display:block;margin-top:20px;font-weight:650}pre{background:#f6f1fc;padding:16px;overflow:auto;font-size:14px}button{padding:10px 16px;border:0;border-radius:10px;background:#6755ab;color:white;margin-top:10px}small{color:#716b80}li{margin:10px 0}</style><main><h1>CUBIC CONNECT · เชื่อม Lark</h1><p>API รับผลพร้อมแล้ว · ยังต้องตั้ง Automation และทดสอบครบก่อนเข้าใช้งานได้</p><h2>1. เพิ่ม callback_token ในตัวอย่าง Webhook</h2><pre>{
 "request_id": "login-test-001",
 "national_id": "0000000000000",
 "callback_token": "sample-only"
}</pre><p>เว็บจะสร้าง request_id และ callback_token ใหม่ทุกครั้ง ห้ามพิมพ์ค่าตัวอย่างเป็นค่าคงที่ในขั้นตอนส่งผล</p><h2>2. ค้นหาพนักงาน</h2><p>เลขบัตรประชาชน เท่ากับ ตัวแปร national_id จาก Webhook เลือกข้อมูลชื่อเล่นและรหัสบันทึก โดยผลต้องมีเพียง 1 คน ไม่พบหรือพบซ้ำจะเข้าไม่ได้</p><h2>3. เพิ่มคำขอ HTTP</h2><p>วิธี: <b>POST</b> · Content-Type: <b>application/json</b></p><label>URL รับผล</label><input readonly value="${esc(callback)}"><label>ชื่อ Header</label><input readonly value="OAI-Sites-Authorization"><label>ค่า Header (เฉพาะเจ้าของเว็บ)</label><input id="secret" type="password" readonly value="Bearer ${esc(e.LARK_CALLBACK_ACCESS_TOKEN)}"><button id="copy">คัดลอกค่า Header</button><p><small>ใช้ค่านี้ในขั้นตอน HTTP ของ Lark เท่านั้น อย่านำไปใส่ใน JSON ตัวอย่างหรือโค้ดหน้าเว็บ</small></p><label>Body ตัวอย่างโครงสร้าง</label><pre>{
 "request_id": "เลือกตัวแปร request_id จากขั้นตอน 1",
 "callback_token": "เลือกตัวแปร callback_token จากขั้นตอน 1",
 "matches": [
  {
   "employee_id": "เลือกรหัสบันทึกของพนักงานที่ค้นพบ",
   "nickname": "เลือกชื่อเล่นของพนักงานที่ค้นพบ"
  }
 ]
}</pre><p>matches ต้องเป็นรายการของพนักงานที่ค้นพบจริงครบทั้งหมด: ไม่พบให้ส่ง [] และพบมากกว่า 1 ให้ส่งทุกรายการ ห้ามใส่คนแรกเพียงคนเดียวหรือกำหนดผลว่าพบไว้ล่วงหน้า</p><p>ต้องดูตัวเลือกผลจาก “ค้นหาบันทึก” เพื่อเลือกวิธีใส่รายการให้ตรงกับหน้าจอ Lark ของคุณก่อนเปิด Automation</p><h2>4. ทดสอบ</h2><p>เปิด Automation แล้วทดสอบจากหน้า Login เว็บจะรอผลไม่เกิน 2 นาที ก่อนแสดงชื่อเล่น การรับ Webhook สำเร็จอย่างเดียวจะไม่ทำให้ Login ผ่าน</p><p>ตอนนี้เชื่อมเฉพาะตัวตนและชื่อเล่น ส่วนประเมินยังเป็นข้อมูลต้นแบบ ไม่ใช่ระบบ HR สำหรับข้อมูลจริง เลขบัตรเป็นเพียงการค้นหารายชื่อ ไม่ได้พิสูจน์ว่าเป็นเจ้าของเลข</p><a href="/">กลับหน้า Login</a></main><script>document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(document.getElementById('secret').value);document.getElementById('copy').textContent='คัดลอกแล้ว'}catch{document.getElementById('secret').type='text';document.getElementById('secret').select()}};</script></html>`;
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'}});
}
