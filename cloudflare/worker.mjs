const LARK_API = "https://open.larksuite.com/open-apis";
const SESSION_SECONDS = 15 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let tokenCache = { key: "", token: "", until: 0 };

class APIError extends Error {
  constructor(status, code, message, larkCode) {
    super(message);
    Object.assign(this, { status, code, larkCode });
  }
}

function config(env) {
  for (const name of ["LARK_APP_ID", "LARK_APP_SECRET", "LARK_APP_TOKEN", "LARK_TABLE_ID"]) {
    if (!env[name]) throw new APIError(503, "configuration_missing", `ยังไม่ได้ตั้งค่า ${name}`);
  }
  return {
    id: env.FIELD_NATIONAL_ID || "เลขบัตรประชาชน",
    nickname: env.FIELD_NICKNAME || "ชื่อเล่น",
    department: env.FIELD_DEPARTMENT || "แผนก",
    status: env.FIELD_STATUS || "สถานะการเป็นพนักงาน",
    active: env.ACTIVE_STATUS_VALUE || "พนักงาน",
    employeeId: env.FIELD_EMPLOYEE_ID || "",
    role: env.FIELD_ROLE || "Role"
  };
}

function reply(request, env, body, status = 200) {
  const origin = env.ALLOWED_ORIGIN || "https://bd-ctrl.github.io";
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "X-Content-Type-Options": "nosniff"
  };
  if (request.headers.get("Origin") === origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function textValue(value) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value).trim();
  if (Array.isArray(value)) {
    const richText = value.every(item => item && typeof item === "object" && "text" in item);
    return value.map(textValue).filter(Boolean).join(richText ? "" : ", ").trim();
  }
  return textValue(value.text ?? value.name ?? value.value ?? "");
}

async function larkJSON(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json();
    if (!response.ok || data.code !== 0) {
      throw new APIError(502, "lark_api_error", "อ่านข้อมูลจาก Lark ไม่สำเร็จ กรุณาตรวจสิทธิ์และชื่อตาราง/คอลัมน์", data.code);
    }
    return data;
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError(502, "lark_unavailable", "เชื่อมต่อ Lark ไม่สำเร็จ กรุณาลองใหม่");
  } finally {
    clearTimeout(timer);
  }
}

async function tenantToken(env) {
  const key = `${env.LARK_APP_ID}:${env.LARK_APP_SECRET}`;
  if (tokenCache.key === key && tokenCache.until > Date.now()) return tokenCache.token;
  const data = await larkJSON(`${LARK_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.LARK_APP_ID, app_secret: env.LARK_APP_SECRET })
  });
  if (!data.tenant_access_token) throw new APIError(502, "invalid_lark_response", "Lark ไม่ได้ส่ง token กลับมา");
  tokenCache = {
    key, token: data.tenant_access_token,
    until: Date.now() + Math.max(0, Number(data.expire || 7200) - 60) * 1000
  };
  return tokenCache.token;
}

async function searchRecords(env, fields, conditions, limit = 10000, tableId = env.LARK_TABLE_ID) {
  const token = await tenantToken(env);
  const records = [];
  const seenPages = new Set();
  let pageToken = "";
  do {
    const url = new URL(`${LARK_API}/bitable/v1/apps/${encodeURIComponent(env.LARK_APP_TOKEN)}/tables/${encodeURIComponent(tableId)}/records/search`);
    url.searchParams.set("page_size", String(Math.min(500, limit - records.length)));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const data = await larkJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        field_names: [...new Set(fields)],
        automatic_fields: false,
        filter: { conjunction: "and", conditions }
      })
    });
    if (!Array.isArray(data.data?.items)) {
      throw new APIError(502, "invalid_lark_response", "ข้อมูลที่ Lark ส่งกลับมาไม่ถูกต้อง");
    }
    records.push(...data.data.items);
    if (records.length >= limit || !data.data.has_more) return records;
    pageToken = data.data.page_token;
    if (!pageToken || seenPages.has(pageToken)) {
      throw new APIError(502, "invalid_pagination", "อ่านข้อมูลพนักงานไม่ครบ กรุณาลองใหม่");
    }
    seenPages.add(pageToken);
  } while (records.length < limit);
  return records;
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unbase64url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

async function sessionKey(env) {
  return crypto.subtle.importKey(
    "raw", encoder.encode(`CUBIC_CONNECT_SESSION_V1|${env.SESSION_SECRET || env.LARK_APP_SECRET}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

async function makeSession(recordId, role, env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(encoder.encode(JSON.stringify({
    sub: recordId, role, iat: now, exp: now + SESSION_SECONDS, aud: "cubic-connect"
  })));
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(env), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

async function readSession(request, env) {
  try {
    const header = request.headers.get("Authorization") || "";
    if (!/^Bearer\s+/i.test(header) || header.length > 4096) return null;
    const parts = header.replace(/^Bearer\s+/i, "").split(".");
    if (parts.length !== 2 || parts.some(part => !/^[\w-]+$/.test(part))) return null;
    const [payload, signature] = parts;
    const valid = await crypto.subtle.verify("HMAC", await sessionKey(env), unbase64url(signature), encoder.encode(payload));
    if (!valid) return null;
    const session = JSON.parse(decoder.decode(unbase64url(payload)));
    const now = Math.floor(Date.now() / 1000);
    return session.aud === "cubic-connect" && typeof session.sub === "string" && session.sub &&
      ["employee", "admin"].includes(session.role) && Number.isInteger(session.exp) && Number.isInteger(session.iat) &&
      session.iat <= now + 60 && session.exp > now && session.exp > session.iat && session.exp - session.iat <= SESSION_SECONDS
      ? session : null;
  } catch { return null; }
}

async function login(request, env, cfg) {
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
    throw new APIError(415, "invalid_content_type", "กรุณาส่งข้อมูลแบบ JSON");
  }
  if (Number(request.headers.get("Content-Length") || 0) > 4096) throw new APIError(413, "request_too_large", "ข้อมูลยาวเกินไป");
  const raw = await request.text();
  if (raw.length > 4096) throw new APIError(413, "request_too_large", "ข้อมูลยาวเกินไป");
  let body;
  try { body = JSON.parse(raw); } catch { throw new APIError(400, "invalid_json", "รูปแบบข้อมูลไม่ถูกต้อง"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new APIError(400, "invalid_json", "รูปแบบข้อมูลไม่ถูกต้อง");
  const admin = typeof body.admin_code === "string";
  const code = String(admin ? body.admin_code : body.national_id || "").trim();
  if (admin ? !/^00009\d{8}$/.test(code) : !/^\d{13}$/.test(code)) {
    throw new APIError(400, "invalid_national_id", "กรุณาตรวจสอบข้อมูลที่กรอก");
  }
  const lookupField = admin && cfg.employeeId ? cfg.employeeId : cfg.id;
  const lookupValue = admin && cfg.employeeId ? code.slice(5) : code;
  const fields = [lookupField, cfg.nickname, cfg.department, cfg.status];
  if (admin) fields.push(cfg.role);
  const records = await searchRecords(env, fields, [{ field_name: lookupField, operator: "is", value: [lookupValue] }], 2);
  if (records.length === 0) throw new APIError(401, "not_found", "ไม่สามารถยืนยันข้อมูลได้ กรุณาตรวจสอบหรือติดต่อ HR");
  if (records.length > 1) throw new APIError(409, "duplicate_employee", "ข้อมูลซ้ำ กรุณาติดต่อ HR ตรวจสอบ");
  const record = records[0], fieldsData = record.fields || {};
  if (!record.record_id) throw new APIError(502, "invalid_lark_response", "ไม่พบรหัสรายการพนักงาน");
  if (textValue(fieldsData[lookupField]) !== lookupValue || textValue(fieldsData[cfg.status]) !== cfg.active) {
    throw new APIError(403, "inactive_employee", "ไม่สามารถใช้งานบัญชีนี้ได้ กรุณาติดต่อ HR");
  }
  if (admin && (textValue(fieldsData[cfg.role]).toLowerCase() !== "admin" || textValue(fieldsData[cfg.nickname]).toUpperCase() !== "ADMIN")) {
    throw new APIError(403, "forbidden", "ไม่สามารถใช้งานบัญชีนี้ได้ กรุณาติดต่อ HR");
  }
  const role = admin ? "admin" : "employee";
  return {
    ok: true,
    employee: { id: record.record_id, nickname: admin ? "ADMIN" : textValue(fieldsData[cfg.nickname]), department: textValue(fieldsData[cfg.department]), role },
    session_token: await makeSession(record.record_id, role, env),
    expires_in: SESSION_SECONDS
  };
}

async function employeeList(request, env, cfg) {
  const session = await readSession(request, env);
  if (!session) throw new APIError(401, "unauthorized", "กรุณาเข้าสู่ระบบใหม่");
  const records = await searchRecords(env, [cfg.nickname, cfg.department, cfg.status], [
    { field_name: cfg.status, operator: "is", value: [cfg.active] }
  ]);
  if (records.length >= 10000) throw new APIError(502, "directory_too_large", "รายชื่อมีจำนวนมากเกินขอบเขตที่ตั้งไว้");
  if (!records.some(record => record.record_id === session.sub && textValue(record.fields?.[cfg.status]) === cfg.active)) {
    throw new APIError(401, "unauthorized", "กรุณาเข้าสู่ระบบใหม่");
  }
  const employees = records
    .filter(record => record.record_id && record.record_id !== session.sub && textValue(record.fields?.[cfg.status]) === cfg.active)
    .map(record => ({ id: record.record_id, nickname: textValue(record.fields?.[cfg.nickname]), department: textValue(record.fields?.[cfg.department]) }))
    .filter(person => person.nickname && person.department && person.nickname.toUpperCase() !== 'ADMIN')
    .sort((a, b) => a.department.localeCompare(b.department, "th") || a.nickname.localeCompare(b.nickname, "th"));
  return { ok: true, departments: [...new Set(employees.map(person => person.department))], employees };
}

// Score fields are separate from the employee registry; no citizen ID is written here.
const DIMENSIONS = ['ความเร็ว', 'ความถูกต้อง', 'การสื่อสาร'];
const REVIEW = {auto:'ผ่านอัตโนมัติ', pending:'รอ HR ตรวจสอบ', approved:'อนุมัติ', rejected:'ไม่อนุมัติ'};
const SCORE_FIELDS = {
  submission:['รหัสแบบประเมิน',1,[1]], round:['รอบประเมิน',1,[1,3]],
  name:['ผู้ถูกประเมิน',1,[1]], department:['แผนกผู้ถูกประเมิน',1,[1,3]],
  dimension:['หัวข้อประเมิน',1,[1,3]], score:['คะแนนดาว',2,[1,2]], reason:['เหตุผลประกอบ',1,[1]],
  status:['สถานะตรวจสอบ',1,[1,3]], note:['หมายเหตุ HR',1,[1]], reviewedAt:['วันที่ตรวจสอบ',5,[1,5]],
  target:['CC_รหัสผู้รับ',1,[1]], rater:['CC_รหัสผู้ประเมิน',1,[1]],
  context:['CC_โปรเจกต์',1,[1]], manifest:['CC_ข้อมูลยืนยัน',1,[1]],
  reviewer:['CC_รหัสผู้ตรวจสอบ',1,[1]], created:['วันที่ประเมิน',5,[1,5]]
};
const sf = key => SCORE_FIELDS[key][0];
function scoreConfig(env) {
  if (!/^[A-Za-z0-9_-]{5,80}$/.test(env.LARK_SCORE_TABLE_ID || '') || env.LARK_SCORE_TABLE_ID === env.LARK_TABLE_ID) {
    throw new APIError(503,'score_configuration_missing','ยังไม่ได้ตั้งค่าตารางคะแนน กรุณาติดต่อ HR');
  }
  const round = env.EVALUATION_ROUND || '2026-10';
  const minimum = Number(env.MIN_RATERS || 3);
  const state = env.ROUND_STATE || 'open';
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(round) || !Number.isInteger(minimum) || minimum < 1 || minimum > 20 || !['open','review','released'].includes(state)) {
    throw new APIError(503,'invalid_score_configuration','ค่ารอบประเมินไม่ถูกต้อง กรุณาติดต่อ HR');
  }
  return {round, minimum, state, policy:'base-v1/min-'+minimum, private:env.SCORE_STORAGE_PRIVATE === 'true'};
}
function requirePrivate(cfg) {
  if (!cfg.private) throw new APIError(503,'score_storage_not_private','ระบบคะแนนยังไม่พร้อมใช้งาน กรุณาให้ HR ตรวจการจำกัดสิทธิ์ Base');
}
async function bodyJSON(request, max = 12000) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw new APIError(415,'invalid_content_type','กรุณาส่งข้อมูลแบบ JSON');
  const raw = await request.text();
  if (raw.length > max) throw new APIError(413,'request_too_large','ข้อมูลยาวเกินไป');
  let body;
  try { body = JSON.parse(raw); } catch { throw new APIError(400,'invalid_json','รูปแบบข้อมูลไม่ถูกต้อง'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new APIError(400,'invalid_json','รูปแบบข้อมูลไม่ถูกต้อง');
  return body;
}
function recordURL(env, tableId, suffix = '') {
  return `${LARK_API}/bitable/v1/apps/${encodeURIComponent(env.LARK_APP_TOKEN)}/tables/${encodeURIComponent(tableId)}${suffix}`;
}
async function baseCall(env, url, method = 'GET', body) {
  return larkJSON(url, {method, headers:{Authorization:`Bearer ${await tenantToken(env)}`, 'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
}
async function employeeById(env, cfg, id) {
  if (!/^[\w-]{3,100}$/.test(id || '')) throw new APIError(400,'invalid_employee','รหัสพนักงานไม่ถูกต้อง');
  const data = await baseCall(env, recordURL(env, env.LARK_TABLE_ID, '/records/'+encodeURIComponent(id)));
  const r = data.data?.record;
  if (!r?.record_id || textValue(r.fields?.[cfg.status]) !== cfg.active) throw new APIError(403,'inactive_employee','บัญชีไม่อยู่ในสถานะใช้งาน กรุณาติดต่อ HR');
  return {id:r.record_id, nickname:textValue(r.fields[cfg.nickname]), department:textValue(r.fields[cfg.department]), isAdmin:textValue(r.fields[cfg.role]).toLowerCase()==='admin' && textValue(r.fields[cfg.nickname]).toUpperCase()==='ADMIN'};
}
async function actor(request, env, cfg, admin = false) {
  const session = await readSession(request, env);
  if (!session) throw new APIError(401,'unauthorized','กรุณาเข้าสู่ระบบใหม่');
  const employee = await employeeById(env, cfg, session.sub);
  if (admin && (session.role !== 'admin' || !employee.isAdmin)) throw new APIError(403,'forbidden','เฉพาะ HR Admin เท่านั้น');
  return employee;
}
async function schema(env) {
  const map = new Map(), pages = new Set(); let page = '';
  do {
    const u = new URL(recordURL(env, env.LARK_SCORE_TABLE_ID, '/fields'));
    u.searchParams.set('page_size','100'); if (page) u.searchParams.set('page_token',page);
    const d = await baseCall(env,u);
    if (!Array.isArray(d.data?.items)) throw new APIError(502,'invalid_lark_response','อ่านคอลัมน์ตารางคะแนนไม่สำเร็จ');
    for (const f of d.data.items) map.set(f.field_name,f);
    if (!d.data.has_more) return map;
    page = d.data.page_token;
    if (!page || pages.has(page)) throw new APIError(502,'invalid_pagination','อ่านคอลัมน์ไม่ครบ');
    pages.add(page);
  } while (pages.size < 20);
  throw new APIError(502,'schema_too_large','ตารางคะแนนมีคอลัมน์เกินขอบเขต');
}
function missingFields(map) { return Object.values(SCORE_FIELDS).filter(([name])=>!map.has(name)).map(([name])=>name); }
function invalidFields(map) { return Object.values(SCORE_FIELDS).filter(([name,,types])=>map.has(name)&&!types.includes(map.get(name).type)).map(([name])=>name); }
function validateExistingFields(map) {
  const invalid=invalidFields(map);
  if (invalid.length) throw new APIError(503,'score_field_type','ชนิดข้อมูลของคอลัมน์ '+invalid.join(' · ')+' ไม่รองรับ กรุณาให้ผู้ดูแลตรวจสอบ ระบบยังไม่เปลี่ยนคอลัมน์หรือข้อมูลเดิม');
}
function validateSchema(map) {
  if (missingFields(map).length) throw new APIError(503,'score_setup_required','ระบบบันทึกคะแนนยังตั้งค่าไม่ครบ กรุณาติดต่อผู้ดูแลระบบ');
  validateExistingFields(map);
}
function fieldValue(map, key, value) {
  const f = map.get(sf(key));
  if (f.type === 2) return Number(value);
  if (f.type === 5) return typeof value === 'number' ? value : Date.parse(value);
  return String(value);
}
async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function uuid(value) {
  const chars=(await hash(value)).slice(0,32).split(''); chars[12]='4'; chars[16]=((parseInt(chars[16],16)&3)|8).toString(16);
  const h=chars.join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
async function raterKey(env,id) { return hash('CUBIC_RATER_V1|'+env.LARK_APP_TOKEN+'|'+id); }
async function setupScores(request,env,cfg) {
  await actor(request,env,cfg,true); const sc=scoreConfig(env); const map=await schema(env); const created=[];
  // Detect incompatible existing columns before creating anything.
  validateExistingFields(map);
  // Add missing columns only; do not rename, delete, or change existing field types.
  for (const [name,type] of Object.values(SCORE_FIELDS)) if (!map.has(name)) {
    const u=new URL(recordURL(env,env.LARK_SCORE_TABLE_ID,'/fields')); u.searchParams.set('client_token',await uuid('field|'+env.LARK_APP_TOKEN+'|'+env.LARK_SCORE_TABLE_ID+'|'+name));
    const d=await baseCall(env,u,'POST',{field_name:name,type});
    const f=d.data?.field;
    if (!f?.field_id) throw new APIError(502,'invalid_lark_response','ยังยืนยันการเพิ่มคอลัมน์ไม่ได้ กรุณาลองเตรียมตารางอีกครั้ง');
    map.set(name,f); created.push(name);
  }
  validateSchema(map);
  const employees=await searchRecords(env,[cfg.department],[{field_name:cfg.status,operator:'is',value:[cfg.active]}]);
  const allowed = {
    round:[sc.round], dimension:DIMENSIONS, status:Object.values(REVIEW),
    department:[...new Set(employees.map(r=>textValue(r.fields?.[cfg.department])).filter(Boolean))]
  };
  for (const [key,values] of Object.entries(allowed)) {
    const f=map.get(sf(key)); if (f.type !== 3) continue;
    const options=f.property?.options || [], extra=values.filter(v=>!options.some(o=>o.name===v));
    if (extra.length) await baseCall(env,recordURL(env,env.LARK_SCORE_TABLE_ID,'/fields/'+encodeURIComponent(f.field_id)),'PUT',{field_name:f.field_name,type:f.type,property:{...f.property,options:[...options,...extra.map(name=>({name}))]}});
  }
  // Re-read the live schema instead of trusting only the field-create response.
  validateSchema(await schema(env));
  return {ok:true,created,storage_private:sc.private,round:sc.round,ready:sc.private};
}
async function scoreRows(env, conditions) {
  const rows=await searchRecords(env,Object.values(SCORE_FIELDS).map(([n])=>n),conditions,10000,env.LARK_SCORE_TABLE_ID);
  if (rows.length >= 10000) throw new APIError(502,'score_data_too_large','ข้อมูลคะแนนมากเกินขอบเขต กรุณาติดต่อ HR');
  return rows;
}
function manifestOf(r) {
  try { const m=JSON.parse(textValue(r.fields?.[sf('manifest')]));return m?.v===1 && /^base-v1\/min-(?:[1-9]|1\d|20)$/.test(m.policy||'') && typeof m.hash==='string' && /^[a-f0-9]{64}$/.test(m.hash) && Number.isFinite(Date.parse(m.created)) ? m : null; } catch {return null;}
}
function canonical(a) { return JSON.stringify([a.round,a.target,a.rater,a.name,a.department,a.context,a.scores,a.reasons]); }
async function groups(rows) {
  const buckets=new Map(), out=[];
  for (const r of rows) {
    const id=textValue(r.fields?.[sf('submission')]); if (!id) continue;
    if (!buckets.has(id)) buckets.set(id,[]); buckets.get(id).push(r);
  }
  for (const [id,all] of buckets) {
    const sorted=all.slice().sort((a,b)=>String(a.record_id).localeCompare(String(b.record_id))), chosen=[];
    let invalid=false;
    for (let i=0;i<3;i++) {
      const candidates=sorted.filter(r=>textValue(r.fields?.[sf('dimension')])===DIMENSIONS[i]);
      if (!candidates.length) {invalid=true;break;}
      // Identical duplicate rows never increase the rater count. Conflicting rows fail closed.
      const relevant=r=>JSON.stringify([r.fields?.[sf('manifest')],textValue(r.fields?.[sf('score')]),textValue(r.fields?.[sf('reason')]),textValue(r.fields?.[sf('status')])]);
      if (candidates.some(r=>relevant(r)!==relevant(candidates[0]))) {invalid=true;break;}
      chosen.push(candidates[0]);
    }
    if (invalid) continue;
    const first=chosen[0],f=first.fields,m=manifestOf(first);
    if (!m || chosen.some(r=>JSON.stringify(manifestOf(r))!==JSON.stringify(m))) continue;
    const a={id,round:textValue(f[sf('round')]),target:textValue(f[sf('target')]),rater:textValue(f[sf('rater')]),name:textValue(f[sf('name')]),department:textValue(f[sf('department')]),context:textValue(f[sf('context')]),created:m.created,policy:m.policy,scores:chosen.map(r=>Number(textValue(r.fields?.[sf('score')]))),reasons:chosen.map(r=>textValue(r.fields?.[sf('reason')])),rows:chosen};
    if (!a.target || !a.rater || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(a.round) || a.scores.some(s=>!Number.isInteger(s)||s<1||s>5) || a.scores.some((s,i)=>s<=3&&!a.reasons[i])) continue;
    if (chosen.some(r=>['round','target','rater','name','department','context'].some(k=>textValue(r.fields?.[sf(k)])!==textValue(f[sf(k)])))) continue;
    if (await hash(canonical(a)) !== m.hash) continue;
    out.push(a);
  }
  const unique=new Map();
  for (const a of out.sort((a,b)=>a.created.localeCompare(b.created)||a.id.localeCompare(b.id))) {
    const key=a.round+'|'+a.target+'|'+a.rater;
    if (!unique.has(key)) unique.set(key,a);
  }
  return [...unique.values()];
}
function validateAssessment(body) {
  if (Object.keys(body).some(k=>!['target_id','round','scores','reasons','context'].includes(k))) throw new APIError(400,'invalid_assessment','ข้อมูลแบบประเมินไม่ถูกต้อง');
  if (typeof body.target_id!=='string' || !/^[\w-]{3,100}$/.test(body.target_id) || typeof body.round!=='string') throw new APIError(400,'invalid_assessment','กรุณาเลือกผู้รับและรอบประเมิน');
  if (!Array.isArray(body.scores) || body.scores.length!==3 || body.scores.some(s=>!Number.isInteger(s)||s<1||s>5)) throw new APIError(400,'invalid_scores','กรุณาให้คะแนนครบ 3 ด้าน ตั้งแต่ 1–5 ดาว');
  if (!Array.isArray(body.reasons) || body.reasons.length!==3 || body.reasons.some(r=>typeof r!=='string'||r.length>500) || body.scores.some((s,i)=>s<=3&&!body.reasons[i].trim())) throw new APIError(400,'reason_required','คะแนน 1–3 ดาวต้องมีเหตุผลแยกแต่ละด้าน');
  if (body.context!==undefined && (typeof body.context!=='string'||body.context.length>180)) throw new APIError(400,'invalid_context','รายละเอียดโปรเจกต์ยาวเกินไป');
}
async function submitAssessment(request,env,cfg) {
  const who=await actor(request,env,cfg),sc=scoreConfig(env); requirePrivate(sc);
  const body=await bodyJSON(request);validateAssessment(body);
  if (sc.state!=='open' || body.round!==sc.round) throw new APIError(409,'round_closed','รอบนี้ปิดรับหรือรอบประเมินเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่');
  if (body.target_id===who.id) throw new APIError(403,'self_assessment','ไม่สามารถประเมินตัวเองได้');
  const target=await employeeById(env,cfg,body.target_id);
  if (!target.nickname || !target.department || target.isAdmin) throw new APIError(403,'ineligible_target','ไม่สามารถเลือกบัญชีนี้เป็นผู้รับการประเมินได้');
  const map=await schema(env);validateSchema(map);
  const rk=await raterKey(env,who.id),id='CC-'+(await hash('submission|'+env.LARK_APP_TOKEN+'|'+body.round+'|'+who.id+'|'+target.id)).slice(0,40);
  const conditions=[{field_name:sf('submission'),operator:'is',value:[id]}];
  const existing=await scoreRows(env,conditions),first=existing.find(manifestOf);
  const snap=first?.fields;
  const a={id,round:sc.round,target:target.id,rater:rk,name:snap?textValue(snap[sf('name')]):target.nickname,department:snap?textValue(snap[sf('department')]):target.department,context:(body.context||'').trim(),scores:body.scores,reasons:body.reasons.map(r=>r.trim()),created:first?manifestOf(first).created:new Date().toISOString(),policy:sc.policy};
  const digest=await hash(canonical(a));
  if (existing.some(r=>manifestOf(r)?.hash!==digest)) throw new APIError(409,'already_assessed','มีผลประเมินของคุณสำหรับคนนี้ในรอบนี้แล้ว คะแนนเดิมจะไม่ถูกเขียนทับ');
  let m=JSON.stringify({v:1,hash:digest,created:a.created,policy:a.policy});
  for (let i=0;i<3;i++) {
    const found=existing.filter(r=>textValue(r.fields?.[sf('dimension')])===DIMENSIONS[i]);
    if (found.length) {
      if (found.some(r=>Number(textValue(r.fields?.[sf('score')]))!==a.scores[i]||textValue(r.fields?.[sf('reason')])!==a.reasons[i])) throw new APIError(409,'conflicting_assessment','ข้อมูลการส่งครั้งก่อนขัดกัน กรุณาติดต่อ HR');
      continue;
    }
    const vals={submission:id,round:a.round,target:a.target,rater:a.rater,name:a.name,department:a.department,dimension:DIMENSIONS[i],score:a.scores[i],reason:a.reasons[i],context:a.context,status:a.scores[i]>=4?REVIEW.auto:REVIEW.pending,manifest:m,created:a.created};
    const fields=Object.fromEntries(Object.entries(vals).map(([k,v])=>[sf(k),fieldValue(map,k,v)]));
    const u=new URL(recordURL(env,env.LARK_SCORE_TABLE_ID,'/records'));u.searchParams.set('client_token',await uuid('answer|'+id+'|'+i));
    const d=await baseCall(env,u,'POST',{fields});
    if (!d.data?.record?.record_id) throw new APIError(502,'save_unconfirmed','ยังยืนยันการบันทึกไม่ได้ กรุณากดส่งอีกครั้ง ระบบจะตรวจรายการเดิมก่อนบันทึก');
    const verified=d.data.record.fields?d.data.record:(await baseCall(env,recordURL(env,env.LARK_SCORE_TABLE_ID,'/records/'+encodeURIComponent(d.data.record.record_id)))).data?.record;
    const returned=manifestOf(verified);
    if (!returned || returned.hash!==digest) throw new APIError(409,'conflicting_assessment','ข้อมูลการส่งครั้งก่อนขัดกัน กรุณาติดต่อ HR');
    if (i===0) {a.created=returned.created;m=JSON.stringify(returned);}
  }
  const saved=(await groups(await scoreRows(env,conditions))).find(x=>x.id===id);
  if (!saved) throw new APIError(502,'save_unconfirmed','ยังยืนยันการบันทึกครบ 3 ด้านไม่ได้ กรุณากดส่งอีกครั้ง');
  return {ok:true,assessment_id:id,persisted:true,answers:3,created:saved.created};
}
function previousRound(round) {const [y,m]=round.split('-').map(Number);return m===1?(y-1)+'-12':y+'-'+String(m-1).padStart(2,'0');}
function summary(all,round,minimum) {
  const rows=all.filter(a=>a.round===round),n=new Set(rows.map(a=>a.rater)).size;
  // Keep the stored policy for historical feedback; mixed versions use the stricter gate.
  if (rows.length) minimum=Math.max(...rows.map(a=>Number(/^base-v1\/min-(\d+)$/.exec(a.policy||'')?.[1]||3)));
  const dims=DIMENSIONS.map((name,i)=>{
    const valid=rows.filter(a=>{const status=textValue(a.rows[i].fields?.[sf('status')]);return (a.scores[i]>=4&&status===REVIEW.auto)||(status===REVIEW.approved&&textValue(a.rows[i].fields?.[sf('note')]));});
    const count=new Set(valid.map(a=>a.rater)).size;
    return {name,mean:n>=minimum&&count>=minimum?valid.reduce((sum,a)=>sum+a.scores[i],0)/valid.length:null};
  });
  const overall=dims.every(d=>d.mean!==null)?dims.reduce((sum,d)=>sum+d.mean,0)/3:null;
  return {round,minimum_raters:minimum,received:n,state:!n?'no_evaluations':n<minimum?'insufficient_data':overall===null?'awaiting_review':'ready',overall,dims};
}
async function employeeState(request,env,cfg) {
  const who=await actor(request,env,cfg),sc=scoreConfig(env);requirePrivate(sc);
  validateSchema(await schema(env));
  const ownKey=await raterKey(env,who.id);
  const rows=await scoreRows(env,[{field_name:sf('target'),operator:'is',value:[who.id]}]);
  // Separate server-side lookups: never send another person's raw feedback to this client.
  const mine=await scoreRows(env,[{field_name:sf('rater'),operator:'is',value:[ownKey]}]);
  const received=await groups(rows),sent=await groups(mine),cutoff=Date.now()-30*86400000;
  const notifications={};
  for (const a of received) if (Date.parse(a.created)>=cutoff&&Date.parse(a.created)<=Date.now()) notifications[a.created]=(notifications[a.created]||0)+1;
  return {ok:true,round:sc.round,round_state:sc.state,policy:{version:sc.policy,minimum_raters:sc.minimum},summary:summary(received,sc.round,sc.minimum),previous:summary(received,previousRound(sc.round),sc.minimum),history:sent.map(a=>({target:a.target,name:a.name,department:a.department,round:a.round,created:a.created})),notifications:Object.entries(notifications).map(([created,count])=>({created,count})).sort((a,b)=>b.created.localeCompare(a.created))};
}
async function hrState(request,env,cfg) {
  await actor(request,env,cfg,true);const sc=scoreConfig(env),map=await schema(env),missing=missingFields(map),invalid=invalidFields(map);
  if (missing.length||invalid.length||!sc.private) return {ok:true,setup_required:!!(missing.length||invalid.length),missing,invalid_fields:invalid,score_table_id:env.LARK_SCORE_TABLE_ID,storage_private:sc.private,round:sc.round,policy:{version:sc.policy,minimum_raters:sc.minimum},reviews:[]};
  validateSchema(map);
  const all=await groups(await scoreRows(env,[{field_name:sf('round'),operator:'is',value:[sc.round]}]));
  const reviews=all.flatMap(a=>a.rows.map((r,i)=>({record_id:r.record_id,name:a.name,department:a.department,dimension:DIMENSIONS[i],score:a.scores[i],reason:a.reasons[i],context:a.context,created:a.created,status:textValue(r.fields?.[sf('status')]),note:textValue(r.fields?.[sf('note')])})).filter(r=>r.score<=3));
  return {ok:true,setup_required:false,missing:[],invalid_fields:[],score_table_id:env.LARK_SCORE_TABLE_ID,storage_private:true,round:sc.round,round_state:sc.state,policy:{version:sc.policy,minimum_raters:sc.minimum},reviews};
}
async function reviewScore(request,env,cfg,id) {
  const who=await actor(request,env,cfg,true),sc=scoreConfig(env);requirePrivate(sc);
  const b=await bodyJSON(request);
  if (Object.keys(b).some(k=>!['decision','note'].includes(k)) || !['approved','rejected'].includes(b.decision)||typeof b.note!=='string'||!b.note.trim()||b.note.length>500) throw new APIError(400,'review_note_required','กรุณาระบุผลตรวจสอบและเหตุผลก่อนยืนยัน');
  const map=await schema(env);validateSchema(map);
  const result=await baseCall(env,recordURL(env,env.LARK_SCORE_TABLE_ID,'/records/'+encodeURIComponent(id))),r=result.data?.record;
  if (!r?.record_id || !manifestOf(r)) throw new APIError(404,'review_not_found','ไม่พบรายการที่ตรวจสอบได้');
  const all=await groups(await scoreRows(env,[{field_name:sf('submission'),operator:'is',value:[textValue(r.fields[sf('submission')])]}]));
  const a=all.find(a=>a.rows.some(x=>x.record_id===id)),index=a?.rows.findIndex(x=>x.record_id===id);
  if (!a || index<0 || a.scores[index]>3) throw new APIError(404,'review_not_found','ไม่พบรายการที่ตรวจสอบได้');
  if (a.round!==sc.round || sc.state==='released') throw new APIError(409,'review_round_closed','รอบนี้เผยแพร่ผลแล้วหรือไม่ได้อยู่ในรอบที่เปิดตรวจสอบ');
  const expected=REVIEW[b.decision],current=textValue(r.fields[sf('status')]);
  if (current!==REVIEW.pending) {
    if (current===expected&&textValue(r.fields[sf('note')])===b.note.trim()) return {ok:true,record_id:id,decision:b.decision};
    throw new APIError(409,'review_conflict','รายการนี้ถูกตรวจสอบแล้ว กรุณาโหลดข้อมูลใหม่');
  }
  const values={status:expected,note:b.note.trim(),reviewer:who.id,reviewedAt:new Date().toISOString()};
  const fields=Object.fromEntries(Object.entries(values).map(([k,v])=>[sf(k),fieldValue(map,k,v)]));
  const u=new URL(recordURL(env,env.LARK_SCORE_TABLE_ID,'/records/'+encodeURIComponent(id)));u.searchParams.set('client_token',await uuid('review|'+id));
  const saved=await baseCall(env,u,'PUT',{fields});
  if (textValue(saved.data?.record?.fields?.[sf('status')])!==expected) throw new APIError(502,'review_unconfirmed','ยังยืนยันผลตรวจสอบไม่ได้ กรุณาโหลดข้อมูลใหม่');
  return {ok:true,record_id:id,decision:b.decision};
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url),origin=request.headers.get('Origin');
    if (origin&&origin!==(env.ALLOWED_ORIGIN||'https://bd-ctrl.github.io')) return reply(request,env,{ok:false,error:'origin_not_allowed',message:'ไม่อนุญาตให้เรียกจากเว็บไซต์นี้'},403);
    if (request.method==='OPTIONS') return reply(request,env,null,204);
    try {
      if (['/','/health'].includes(url.pathname)&&request.method==='GET') return reply(request,env,{ok:true,service:'CUBIC CONNECT API',version:'scores-v1',capabilities:['employees','assessments','results','hr-review']});
      const methods={'/login':'POST','/employees':'GET','/me/state':'GET','/hr/state':'GET','/hr/setup':'POST','/assessments':'POST'};
      const review=url.pathname.match(/^\/hr\/reviews\/([\w-]{3,100})$/);
      const method=review?'POST':methods[url.pathname];
      if (!method) throw new APIError(404,'not_found','ไม่พบ API นี้');
      if (request.method!==method) throw new APIError(405,'method_not_allowed','วิธีเรียก API ไม่ถูกต้อง');
      if (url.search) throw new APIError(400,'unexpected_query','เส้นทางนี้ไม่รับรหัสผู้ใช้งานจาก URL');
      const cfg=config(env);let body;
      if (url.pathname==='/login') body=await login(request,env,cfg);
      else if (url.pathname==='/employees') body=await employeeList(request,env,cfg);
      else if (url.pathname==='/me/state') body=await employeeState(request,env,cfg);
      else if (url.pathname==='/hr/state') body=await hrState(request,env,cfg);
      else if (url.pathname==='/hr/setup') body=await setupScores(request,env,cfg);
      else if (url.pathname==='/assessments') body=await submitAssessment(request,env,cfg);
      else body=await reviewScore(request,env,cfg,review[1]);
      return reply(request,env,body);
    } catch(error) {
      const known=error instanceof APIError;
      return reply(request,env,{ok:false,error:known?error.code:'internal_error',message:known?error.message:'ระบบขัดข้อง กรุณาลองใหม่',...(known&&error.larkCode!=null?{lark_code:error.larkCode}:{})},known?error.status:500);
    }
  }
};

