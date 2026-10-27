# CUBIC CONNECT

ซอร์สโค้ดแอปประเมินข้ามแผนก SUITCUBE และหน้าล็อกอินสำหรับ GitHub Pages

## เปิดเว็บไซต์

GitHub Settings → Pages → Deploy from a branch → main → / (root) → Save

URL หลังเปิด Pages: https://bd-ctrl.github.io/HR-Connect/

## โค้ดล็อกอินอยู่ที่ไหน

- `login.js`: หน้า Login เวอร์ชัน GitHub Pages (ยังไม่ส่งเลขบัตรไปตรวจสอบ)
- `public/login.js`: โค้ด Login จากแอปเดิม เรียก /api/login และ /api/login/status
- `lib/login-api.js`: เซิร์ฟเวอร์ส่ง Webhook ไป Lark รับผล callback และจัดการ session
- `app/api/[...path]/route.ts`: route ฝั่งเซิร์ฟเวอร์
- `db/schema.ts`, `drizzle/`: โครงสร้างฐานข้อมูล login challenge/session

## สถานะการเชื่อมต่อ

GitHub Pages แสดง HTML, CSS, JavaScript และรูป/GIF ได้ แต่รัน API ไม่ได้ หน้าล็อกอินของ Pages จึงแสดงข้อความว่ายังไม่เชื่อม API และไม่ส่งหรือเก็บเลขบัตรประชาชน ไม่มีการจำลองว่า Login ผ่าน

API เดิมอาศัย Cloudflare D1 และ Sites authenticated identity รวมทั้ง service-access validation ที่ hosting dispatch จึงต้องปรับ authentication, CORS, cookie policy และ callback protection หากจะย้ายไปใช้ร่วมกับ GitHub Pages ห้ามเปิด API เดิมตรงๆ โดยตัดการตรวจสิทธิ์ออก

ค่าฝั่งเซิร์ฟเวอร์ที่ต้องตั้ง: DB, SITE_ORIGIN, LARK_LOGIN_WEBHOOK_URL, LARK_CALLBACK_ACCESS_TOKEN, SETUP_OWNER_EMAIL ไม่มีค่า secret จริงใน repository และไม่มีทะเบียนพนักงานจริง

ต้นแบบส่วนประเมิน/HR ยังใช้ข้อมูลสังเคราะห์ การค้นหาเลขบัตรอย่างเดียวไม่พิสูจน์ความเป็นเจ้าของบัญชี ปัญหาผลตอบกลับ Lark เดิมยังไม่ได้ยืนยันว่าแก้สำเร็จ

## ซอร์สเซิร์ฟเวอร์เดิม

`app/`, `lib/`, `worker/`, `public/`, `db/`, `scripts/` และ package lock เก็บโครงสร้างต้นแบบ Vinext/Cloudflare เดิม ไม่มี Site project identity หรือ runtime secrets การ deploy ต้องผูก hosting และฐานข้อมูลของผู้ดูแลเอง

## ตรวจสอบ

ใช้ Node 22.13+ รัน `node test.cjs`, `node --experimental-sqlite login-test.mjs`, `node login-ui-test.mjs`
