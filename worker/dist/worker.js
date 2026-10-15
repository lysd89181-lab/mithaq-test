// ميثاق | MITHAQ API — ملف مجمّع تلقائياً (لا تعدّل هنا، عدّل src/ ثم node build.mjs)

// ===== lib/util.js =====
// أدوات عامة للسيرفر

class ApiError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, message, code) => { throw new ApiError(status, message, code); };

// تقريب المبالغ لـ 3 خانات (الدينار الليبي)
const money = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const num = (v, def = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
};

const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

function invoiceNo(prefix = 'MQ') {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const rnd = crypto.getRandomValues(new Uint32Array(1))[0] % 90000 + 10000;
  return `${prefix}-${ymd}-${rnd}`;
}

function randomId(len = 20) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => abc[x % abc.length]).join('');
}

// معرّف آمن للمستندات من نص يرسله العميل
const safeId = (s, max = 60) => str(s, max).replace(/[^A-Za-z0-9_-]/g, '');

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJson(req) {
  try {
    const t = await req.text();
    if (t.length > 50000) fail(413, 'الطلب كبير جداً');
    return t ? JSON.parse(t) : {};
  } catch (e) {
    if (e instanceof ApiError) throw e;
    fail(400, 'صيغة الطلب غير صحيحة');
  }
}

// ===== lib/google.js =====
// المصادقة مع قوقل: توكن حساب الخدمة + التحقق من توكن المستخدم (Firebase ID Token)


const b64url = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlJson = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const fromB64url = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

let saCache = null;
function serviceAccount(env) {
  if (saCache) return saCache;
  if (!env.FIREBASE_SERVICE_ACCOUNT) fail(500, 'السيرفر غير مُعد: FIREBASE_SERVICE_ACCOUNT ناقص', 'config');
  try {
    saCache = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    fail(500, 'FIREBASE_SERVICE_ACCOUNT ليس JSON صحيح', 'config');
  }
  return saCache;
}

const projectId = (env) => env.FIREBASE_PROJECT_ID || serviceAccount(env).project_id;

let tokenCache = { token: null, exp: 0 };
const SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/identitytoolkit',
  'https://www.googleapis.com/auth/cloud-platform',
].join(' ');

async function importPrivateKey(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// توكن وصول لحساب الخدمة (يتخزن لين قرب انتهائه)
async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
  const sa = serviceAccount(env);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64url(sig)}`,
  });
  const out = await res.json();
  if (!res.ok) fail(500, 'تعذر الحصول على صلاحية قوقل: ' + (out.error_description || out.error), 'google_auth');
  tokenCache = { token: out.access_token, exp: now + (out.expires_in || 3600) };
  return tokenCache.token;
}

// مفاتيح Firebase العامة للتحقق من توكن المستخدم
let jwksCache = { keys: null, exp: 0 };
async function firebaseKeys() {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.exp > now) return jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) fail(503, 'تعذر التحقق من الهوية حالياً');
  const data = await res.json();
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  jwksCache = { keys: data.keys || [], exp: now + (m ? Number(m[1]) * 1000 : 3600_000) };
  return jwksCache.keys;
}

async function verifyIdToken(env, token) {
  if (!token) fail(401, 'سجل دخولك أولاً', 'unauthenticated');
  const parts = token.split('.');
  if (parts.length !== 3) fail(401, 'جلسة غير صالحة', 'unauthenticated');
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  } catch {
    fail(401, 'جلسة غير صالحة', 'unauthenticated');
  }
  if (header.alg !== 'RS256') fail(401, 'جلسة غير صالحة', 'unauthenticated');
  const keys = await firebaseKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) fail(401, 'انتهت الجلسة، سجل دخولك من جديد', 'unauthenticated');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) fail(401, 'جلسة غير صالحة', 'unauthenticated');
  const pid = projectId(env);
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== pid || payload.iss !== `https://securetoken.google.com/${pid}`) fail(401, 'جلسة غير صالحة', 'unauthenticated');
  if (!payload.sub || payload.exp < now || payload.iat > now + 300) fail(401, 'انتهت الجلسة، سجل دخولك من جديد', 'unauthenticated');
  return { uid: payload.sub, email: payload.email || '', emailVerified: payload.email_verified === true, name: payload.name || '' };
}

// البحث عن مستخدم بالإيميل (لإضافة الموظفين)
async function lookupUserByEmail(env, email) {
  const token = await accessToken(env);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId(env)}/accounts:lookup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: [email] }),
  });
  const out = await res.json();
  if (!res.ok) fail(500, 'تعذر البحث عن المستخدم');
  return (out.users && out.users[0]) || null;
}

// ===== lib/firestore.js =====
// عميل Firestore REST بصلاحية حساب الخدمة (يتجاوز القواعد) مع دعم المعاملات (Transactions)



function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { nullValue: null };
    return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  return { stringValue: String(v) };
}
function encodeFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) f[k] = encode(v);
  return f;
}
function decode(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}
function decodeFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields || {})) o[k] = decode(v);
  return o;
}

const OPS = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', in: 'IN', 'array-contains': 'ARRAY_CONTAINS' };

class Firestore {
  constructor(env) {
    this.env = env;
    this.root = `projects/${projectId(env)}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
  }
  name(path) { return `${this.root}/${path}`; }

  async req(method, url, body) {
    const token = await accessToken(this.env);
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const out = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const status = out.error?.status || '';
      const err = new ApiError(res.status === 409 || status === 'ABORTED' ? 409 : 500, out.error?.message || 'Firestore error', status || 'firestore');
      err.fsStatus = status;
      err.httpStatus = res.status;
      throw err;
    }
    return out;
  }

  docFrom(d) {
    const path = d.name.slice(this.root.length + 1);
    return { id: path.split('/').pop(), path, data: decodeFields(d.fields), updateTime: d.updateTime };
  }

  async get(path, tx) {
    const q = tx ? `?transaction=${encodeURIComponent(tx)}` : '';
    try {
      return this.docFrom(await this.req('GET', `${this.base}/${path}${q}`));
    } catch (e) {
      if (e.httpStatus === 404) return null;
      throw e;
    }
  }

  // filters: [['field','==',value], ...]
  async query(collection, filters = [], opts = {}, tx) {
    const sq = { from: [{ collectionId: collection }] };
    const fs = filters.map(([field, op, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: OPS[op], value: encode(value) } }));
    if (fs.length === 1) sq.where = fs[0];
    else if (fs.length > 1) sq.where = { compositeFilter: { op: 'AND', filters: fs } };
    if (opts.orderBy) sq.orderBy = [{ field: { fieldPath: opts.orderBy }, direction: opts.desc ? 'DESCENDING' : 'ASCENDING' }];
    if (opts.limit) sq.limit = opts.limit;
    const body = { structuredQuery: sq };
    if (tx) body.transaction = tx;
    const out = await this.req('POST', `${this.base}:runQuery`, body);
    return (Array.isArray(out) ? out : []).filter((r) => r.document).map((r) => this.docFrom(r.document));
  }

  // ===== بناء عمليات الكتابة =====
  wSet(path, data) { return { update: { name: this.name(path), fields: encodeFields(data) } }; }
  wCreate(path, data) { return { ...this.wSet(path, data), currentDocument: { exists: false } }; }
  wUpdate(path, data) {
    return { update: { name: this.name(path), fields: encodeFields(data) }, updateMask: { fieldPaths: Object.keys(data) }, currentDocument: { exists: true } };
  }
  wIncrement(path, field, by) {
    return { transform: { document: this.name(path), fieldTransforms: [{ fieldPath: field, increment: encode(by) }] } };
  }
  wDelete(path) { return { delete: this.name(path) }; }

  async commit(writes, tx) {
    if (!writes.length) return;
    const body = { writes };
    if (tx) body.transaction = tx;
    return this.req('POST', `${this.base}:commit`, body);
  }

  // تنفيذ معاملة كاملة مع إعادة المحاولة عند التعارض
  async transaction(fn, attempts = 4) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      const { transaction: tx } = await this.req('POST', `${this.base}:beginTransaction`, { options: { readWrite: {} } });
      // نجمع الكتابات لكل مستند في كتابة وحدة (Firestore ما يقبلش تعديل نفس المستند مرتين في commit)
      const ops = new Map();
      const op = (p) => { if (!ops.has(p)) ops.set(p, { kind: null, data: {}, inc: {} }); return ops.get(p); };
      const t = {
        get: (p) => this.get(p, tx),
        query: (c, f, o) => this.query(c, f, o, tx),
        set: (p, d) => { const o = op(p); o.kind = 'set'; o.data = { ...d }; },
        create: (p, d) => { const o = op(p); o.kind = 'create'; o.data = { ...d }; },
        update: (p, d) => { const o = op(p); if (!o.kind) o.kind = 'update'; Object.assign(o.data, d); },
        increment: (p, f, n) => { const o = op(p); o.inc[f] = (o.inc[f] || 0) + n; },
        delete: (p) => { const o = op(p); o.kind = 'delete'; },
      };
      try {
        const result = await fn(t);
        const writes = [];
        for (const [p, o] of ops) {
          const transforms = Object.entries(o.inc).map(([field, by]) => ({ fieldPath: field, increment: encode(by) }));
          if (o.kind === 'delete') { writes.push(this.wDelete(p)); continue; }
          if (!o.kind) { writes.push({ transform: { document: this.name(p), fieldTransforms: transforms } }); continue; }
          const w = o.kind === 'set' ? this.wSet(p, o.data) : o.kind === 'create' ? this.wCreate(p, o.data) : this.wUpdate(p, o.data);
          if (transforms.length) w.updateTransforms = transforms;
          writes.push(w);
        }
        if (writes.length) await this.commit(writes, tx);
        else await this.req('POST', `${this.base}:rollback`, { transaction: tx }).catch(() => {});
        return result;
      } catch (e) {
        if (e.fsStatus === 'ABORTED') { lastErr = e; await new Promise((r) => setTimeout(r, 120 * (i + 1))); continue; }
        await this.req('POST', `${this.base}:rollback`, { transaction: tx }).catch(() => {});
        if (e.fsStatus === 'ALREADY_EXISTS' || (e.fsStatus === 'FAILED_PRECONDITION' && /exist/i.test(e.message))) {
          fail(409, 'هذا الطلب تم تنفيذه مسبقاً', 'duplicate');
        }
        throw e;
      }
    }
    throw lastErr || new ApiError(503, 'الضغط عالي، حاول مرة أخرى');
  }
}

// ===== lib/notify.js =====
// إشعارات قوقل (FCM) + سجل الإشعارات داخل الموقع



// معرّف يترتب من الأحدث للأقدم تلقائياً (Firestore يرتب حسب المعرّف)
const newestFirstId = () => `${String(9999999999999 - Date.now()).padStart(13, '0')}${randomId(6)}`;

async function sendToToken(env, fs, tokenDoc, msg) {
  const token = await accessToken(env);
  const link = msg.link || env.SITE_URL || '';
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId(env)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: tokenDoc.data.token,
        notification: { title: msg.title, body: msg.body },
        data: { link, type: msg.type || 'general' },
        webpush: {
          notification: { icon: msg.icon || (env.SITE_URL ? `${env.SITE_URL}/assets/icon-192.png` : undefined), dir: 'rtl', lang: 'ar' },
          fcm_options: link ? { link } : undefined,
        },
      },
    }),
  });
  if (!res.ok) {
    const out = await res.json().catch(() => ({}));
    const code = out.error?.details?.[0]?.errorCode || out.error?.status;
    // توكن منتهي: نمسحه
    if (res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') {
      await fs.commit([fs.wDelete(tokenDoc.path)]).catch(() => {});
    }
  }
}

async function sendMany(env, fs, tokens, msg) {
  const list = tokens.slice(0, 500);
  for (let i = 0; i < list.length; i += 20) {
    await Promise.allSettled(list.slice(i, i + 20).map((t) => sendToToken(env, fs, t, msg)));
  }
}

// إشعار لزبون معيّن (ويتسجل في مركز الإشعارات)
async function notifyUser(env, fs, userId, msg) {
  try {
    await fs.commit([fs.wSet(`notifications/${newestFirstId()}`, {
      userId, title: msg.title, body: msg.body, link: msg.link || '', type: msg.type || 'general', createdAt: new Date(),
    })]);
    const tokens = await fs.query('push_tokens', [['uid', '==', userId]], { limit: 20 });
    await sendMany(env, fs, tokens, msg);
  } catch (e) {
    console.log('notifyUser failed', e.message);
  }
}

// إشعار لكل الإدارة والموظفين
async function notifyStaff(env, fs, msg) {
  try {
    const tokens = await fs.query('push_tokens', [['isStaff', '==', true]], { limit: 100 });
    await sendMany(env, fs, tokens, { ...msg, link: msg.link || (env.SITE_URL ? `${env.SITE_URL}/admin/` : '') });
  } catch (e) {
    console.log('notifyStaff failed', e.message);
  }
}

// إشعار عام لكل الزبائن
async function notifyAll(env, fs, msg) {
  await fs.commit([fs.wSet(`notifications/${newestFirstId()}`, {
    userId: 'all', title: msg.title, body: msg.body, link: msg.link || '', type: 'broadcast', createdAt: new Date(),
  })]);
  const tokens = await fs.query('push_tokens', [], { limit: 500 });
  await sendMany(env, fs, tokens, msg);
  return tokens.length;
}

// ===== lib/context.js =====
// هوية المستخدم وصلاحياته + إعدادات المتجر



const PERMS = ['orders', 'deposits', 'products', 'stock', 'users', 'wallet', 'coupons', 'reports', 'notify', 'settings', 'audit'];

let settingsCache = { data: null, exp: 0 };
async function getSettings(fs) {
  if (settingsCache.data && settingsCache.exp > Date.now()) return settingsCache.data;
  const doc = await fs.get('app/settings');
  settingsCache = { data: doc?.data || {}, exp: Date.now() + 30_000 };
  return settingsCache.data;
}

async function requireUser(req, env, fs, { verified = true } = {}) {
  const h = req.headers.get('Authorization') || '';
  const user = await verifyIdToken(env, h.startsWith('Bearer ') ? h.slice(7) : '');
  if (verified) {
    const s = await getSettings(fs);
    if (s.require_email_verification !== false && !user.emailVerified) {
      fail(403, 'أكّد بريدك الإلكتروني أولاً من صفحة حسابي', 'email_not_verified');
    }
  }
  return user;
}

async function requireStaff(req, env, fs, perm) {
  const user = await requireUser(req, env, fs, { verified: false });
  const doc = await fs.get(`admins/${user.uid}`);
  if (!doc) fail(403, 'هذا الحساب لا يملك صلاحية إدارة', 'forbidden');
  const isAdmin = doc.data.role === 'admin';
  const perms = doc.data.perms || {};
  if (perm && !isAdmin && !(doc.data.role === 'staff' && perms[perm] === true)) fail(403, 'ما عندكش صلاحية لهذا الإجراء', 'forbidden');
  if (perm === 'admin' && !isAdmin) fail(403, 'هذا الإجراء للمدير فقط', 'forbidden');
  return { ...user, isAdmin, staffName: doc.data.name || user.email };
}

// حساب سعر المنتج النهائي (نفس منطق المتجر القديم للتوافق)
function productPricing(p) {
  const base = num(p.priceLYD ?? p.price);
  const discount = Math.min(Math.max(num(p.discount), 0), 99);
  const final = discount > 0 ? base - (base * discount) / 100 : base;
  const qtyMode = p.enableQuantity === true;
  const qtyMin = qtyMode ? Math.max(1, Math.floor(num(p.qtyMin, 1))) : 1;
  const qtyMax = qtyMode ? Math.max(qtyMin, Math.floor(num(p.qtyMax, 100))) : 10;
  return { base, final, qtyMode, qtyMin, qtyMax, unit: qtyMode ? final / qtyMin : final };
}

function lineTotal(p, qty) {
  const pr = productPricing(p);
  return money(pr.unit * qty);
}

// ===== routes/coupons.js =====
// الكوبونات



const normalizeCode = (c) => safeId(String(c || '').toUpperCase(), 30);
const couponUseId = (code, uid) => `${code}_${uid}`;

// يحسب الخصم أو يرمي خطأ بسبب واضح
function evaluateCoupon(c, uses, subtotal) {
  if (!c || c.active === false) fail(404, 'الكوبون غير صحيح أو منتهي', 'coupon_invalid');
  const exp = c.expiresAt instanceof Date ? c.expiresAt : (c.expiresAt ? new Date(c.expiresAt) : null);
  if (exp && exp.getTime() < Date.now()) fail(410, 'الكوبون منتهي الصلاحية', 'coupon_expired');
  if (num(c.maxUses) > 0 && num(c.usedCount) >= num(c.maxUses)) fail(410, 'الكوبون وصل للحد الأقصى من الاستخدام', 'coupon_exhausted');
  const perUser = num(c.perUserLimit, 1);
  if (perUser > 0 && num(uses?.count) >= perUser) fail(409, 'استخدمت هذا الكوبون قبل', 'coupon_used');
  if (num(c.minAmount) > 0 && subtotal < num(c.minAmount)) fail(400, `الكوبون يحتاج طلب بقيمة ${num(c.minAmount).toFixed(3)} د.ل على الأقل`, 'coupon_min');
  let discount = c.type === 'fixed' ? num(c.value) : (subtotal * Math.min(num(c.value), 100)) / 100;
  if (c.type !== 'fixed' && num(c.maxDiscount) > 0) discount = Math.min(discount, num(c.maxDiscount));
  discount = money(Math.min(Math.max(discount, 0), subtotal));
  return { discount, label: c.type === 'fixed' ? `${num(c.value)} د.ل` : `${num(c.value)}%` };
}

async function checkCoupon(req, env, fs) {
  const user = await requireUser(req, env, fs, { verified: false });
  const body = await readJson(req);
  const code = normalizeCode(body.code);
  if (!code) fail(400, 'أدخل كود الكوبون');
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  let subtotal = 0;
  for (const it of items) {
    const pid = safeId(it.productId, 64);
    const p = pid ? await fs.get(`products/${pid}`) : null;
    if (p && p.data.active !== false) subtotal += lineTotal(p.data, Math.max(1, Math.floor(num(it.qty, 1))));
  }
  subtotal = money(subtotal);
  const [c, uses] = await Promise.all([fs.get(`coupons/${code}`), fs.get(`coupon_uses/${couponUseId(code, user.uid)}`)]);
  const r = evaluateCoupon(c?.data, uses?.data, subtotal);
  return { ok: true, code, ...r, subtotal, total: money(subtotal - r.discount) };
}

// ===== routes/checkout.js =====
// الشراء: السلة كاملة في معاملة وحدة (السعر من القاعدة، الرصيد، الكوبون، التسليم التلقائي)





const MAX_ITEMS = 20;

// سحب أكواد/حسابات من المخزون داخل المعاملة. يرجّع null لو المخزون ما يكفيش
async function allocateStock(t, product, productId, need, orderId, uid) {
  // الكتابات في المعاملة مؤجلة للآخر، فنتتبع اللي حجزناه بنفسنا عشان ما يتكررش نفس الكود
  t.taken = t.taken || { codes: new Set(), slots: {} };
  if (product.deliveryType === 'stock_code') {
    const found = await t.query('stock_codes', [['productId', '==', productId], ['status', '==', 'available']], { limit: need + t.taken.codes.size });
    const codes = found.filter((c) => !t.taken.codes.has(c.id)).slice(0, need);
    if (codes.length < need) return null;
    codes.forEach((c) => t.taken.codes.add(c.id));
    const now = new Date();
    for (const c of codes) t.update(c.path, { status: 'sold', orderId, userId: uid, soldAt: now });
    return { type: 'stock_code', data: codes.map((c) => c.data.code).join('\n'), refs: codes.map((c) => c.id) };
  }
  if (product.deliveryType === 'shared_account') {
    const accs = await t.query('shared_accounts', [['productId', '==', productId]], { limit: 100 });
    const lines = [];
    const used = [];
    let left = need;
    for (const a of accs) {
      if (left <= 0) break;
      const cap = Math.max(1, num(a.data.capacity, 1));
      const usedSlots = num(a.data.usedSlots) + (t.taken.slots[a.id] || 0);
      if ((a.data.status || 'active') === 'full' || usedSlots >= cap) continue;
      const take = Math.min(cap - usedSlots, left);
      const newUsed = usedSlots + take;
      t.taken.slots[a.id] = (t.taken.slots[a.id] || 0) + take;
      t.update(a.path, { usedSlots: newUsed, status: newUsed >= cap ? 'full' : 'active' });
      for (let i = 0; i < take; i++) { lines.push(a.data.accountData); used.push(a.id); }
      left -= take;
    }
    if (left > 0) return null;
    return { type: 'shared_account', data: lines.join('\n—————\n'), refs: used };
  }
  return null;
}

async function checkout(req, env, fs, ctx) {
  const user = await requireUser(req, env, fs);
  const body = await readJson(req);
  const checkoutId = safeId(body.checkoutId, 40);
  if (checkoutId.length < 8) fail(400, 'معرّف العملية غير صالح');
  const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS + 1) : [];
  if (!items.length) fail(400, 'السلة فاضية');
  if (items.length > MAX_ITEMS) fail(400, `الحد الأقصى ${MAX_ITEMS} منتج في الطلب الواحد`);
  const contactPhone = str(body.contactPhone, 40);
  if (contactPhone.length < 6) fail(400, 'أدخل رقم تواصل صحيح');
  const code = normalizeCode(body.coupon);

  const result = await fs.transaction(async (t) => {
    const userDoc = await t.get(`users/${user.uid}`);
    if (!userDoc) fail(404, 'حسابك غير مكتمل، سجل خروج ودخول من جديد');
    const u = userDoc.data;
    if (u.isActive === false) fail(403, 'حسابك موقوف، تواصل مع الدعم');
    const last = u.lastCheckoutAt instanceof Date ? u.lastCheckoutAt.getTime() : 0;
    if (Date.now() - last < 4000) fail(429, 'استنى ثواني بين كل عملية شراء', 'rate_limited');

    // جلب المنتجات
    const products = {};
    for (const it of items) {
      const pid = safeId(it.productId, 64);
      if (!pid) fail(400, 'منتج غير صالح');
      if (!products[pid]) {
        const d = await t.get(`products/${pid}`);
        if (!d || d.data.active === false) fail(409, 'منتج في السلة لم يعد متوفراً، حدّث السلة', 'product_unavailable');
        products[pid] = d.data;
      }
    }

    // التحقق من كل بند وحساب السعر
    const lines = items.map((it) => {
      const pid = safeId(it.productId, 64);
      const p = products[pid];
      const pr = productPricing(p);
      const qty = Math.floor(num(it.qty, pr.qtyMin));
      if (qty < pr.qtyMin || qty > pr.qtyMax) fail(400, `الكمية لـ "${p.name}" لازم بين ${pr.qtyMin} و ${pr.qtyMax}`);
      const data = str(it.data, 300);
      if (p.fieldEnabled !== false && !data) fail(400, `أدخل البيانات المطلوبة لـ "${p.name}"`);
      return { pid, p, qty, data, total: lineTotal(p, qty) };
    });
    const subtotal = money(lines.reduce((s, l) => s + l.total, 0));
    if (subtotal <= 0) fail(400, 'قيمة الطلب غير صحيحة');

    // الكوبون
    let discount = 0;
    let couponDoc = null;
    let usesDoc = null;
    if (code) {
      couponDoc = await t.get(`coupons/${code}`);
      usesDoc = await t.get(`coupon_uses/${couponUseId(code, user.uid)}`);
      discount = evaluateCoupon(couponDoc?.data, usesDoc?.data, subtotal).discount;
    }
    const total = money(subtotal - discount);
    const before = money(u.balance);
    if (before < total) fail(402, `رصيدك ${before.toFixed(3)} د.ل ما يكفيش. المطلوب ${total.toFixed(3)} د.ل`, 'insufficient_balance');
    const after = money(before - total);

    // توزيع الخصم على البنود
    let remaining = discount;
    lines.forEach((l, i) => {
      const share = i === lines.length - 1 ? remaining : money((discount * l.total) / subtotal);
      remaining = money(remaining - share);
      l.discount = share;
      l.paid = money(l.total - share);
    });

    // إنشاء الطلبات + التسليم التلقائي
    const now = new Date();
    const userName = u.name || u.username || user.email;
    const orders = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const orderId = `${checkoutId}-${i + 1}`;
      const pr = productPricing(l.p);
      const delivered = l.p.deliveryType && l.p.deliveryType !== 'manual'
        ? await allocateStock(t, l.p, l.pid, pr.qtyMode ? 1 : l.qty, orderId, user.uid)
        : null;
      const order = {
        userId: user.uid, userName, userEmail: user.email,
        productId: l.pid, serviceName: l.p.name || 'منتج', cardName: l.p.name || 'منتج',
        categoryId: l.p.categoryId || '',
        playerID: l.data || (pr.qtyMode ? `${l.qty} قطعة` : 'مباشر'),
        contactPhone, quantity: l.qty,
        unitPrice: money(pr.unit), subtotal: l.total, discount: l.discount,
        amount: l.paid, price: l.paid,
        couponCode: code || null,
        invoiceNumber: invoiceNo('MQ'), checkoutId,
        status: delivered ? 'completed' : 'pending',
        deliveryType: l.p.deliveryType || 'manual',
        createdAt: now,
      };
      if (delivered) {
        Object.assign(order, {
          deliveredData: delivered.data, deliveredType: delivered.type, deliveredAt: now,
          deliveredRefs: delivered.refs, deliveredAccountId: delivered.type === 'shared_account' ? delivered.refs[0] : null,
        });
      }
      t.create(`orders/${orderId}`, order);
      t.increment(`products/${l.pid}`, 'sales', l.qty);
      orders.push({ id: orderId, ...order });
    }

    t.update(`users/${user.uid}`, { balance: after, lastCheckoutAt: now });
    t.create(`wallet_tx/${checkoutId}`, {
      userId: user.uid, type: 'purchase', amount: -total, balanceBefore: before, balanceAfter: after,
      ref: checkoutId, note: lines.map((l) => l.p.name).join('، ').slice(0, 300), createdAt: now,
    });
    if (couponDoc && discount > 0) {
      t.increment(`coupons/${code}`, 'usedCount', 1);
      t.set(`coupon_uses/${couponUseId(code, user.uid)}`, {
        code, userId: user.uid, count: num(usesDoc?.data?.count) + 1, lastAt: now,
      });
    }
    return { orders, subtotal, discount, total, balance: after };
  });

  // الإشعارات بعد نجاح العملية
  const pending = result.orders.filter((o) => o.status === 'pending');
  const done = result.orders.filter((o) => o.status === 'completed');
  ctx.waitUntil((async () => {
    if (pending.length) {
      await notifyStaff(env, fs, {
        title: `🛒 طلب جديد (${pending.length})`,
        body: `${pending[0].userName}: ${pending.map((o) => o.serviceName).join('، ')} — ${result.total.toFixed(3)} د.ل`,
        type: 'order',
      });
    }
    if (done.length) {
      await notifyUser(env, fs, user.uid, {
        title: '✅ تم تسليم طلبك', body: `${done.map((o) => o.serviceName).join('، ')} — افتح طلباتي لعرض الكود`, type: 'order', link: env.SITE_URL ? `${env.SITE_URL}/#/orders` : '',
      });
    }
  })());

  return {
    ok: true,
    total: result.total, discount: result.discount, balance: result.balance,
    orders: result.orders.map((o) => ({
      id: o.id, invoiceNumber: o.invoiceNumber, productName: o.serviceName, status: o.status,
      amount: o.amount, quantity: o.quantity, deliveredData: o.deliveredData || null,
    })),
  };
}

// ===== routes/wallet.js =====
// طلبات شحن المحفظة




const METHODS = {
  libyana: { title: 'ليبيانا ومدار', field: 'phone' },
  binance: { title: 'بايننس', field: 'phone', crypto: true },
  cards: { title: 'كروت تعبئة', field: 'card_code' },
};

async function createDeposit(req, env, fs, ctx) {
  const user = await requireUser(req, env, fs);
  const body = await readJson(req);
  const method = METHODS[body.method];
  if (!method) fail(400, 'طريقة الدفع غير معروفة');
  const settings = await getSettings(fs);
  const enabled = (settings.payment_methods || []).find((m) => m.id === body.method);
  if (enabled && enabled.active === false) fail(400, 'طريقة الدفع هذي متوقفة حالياً');

  const value = str(body.value, 80);
  if (value.length < 4) fail(400, method.field === 'card_code' ? 'أدخل رقم الكرت كامل' : 'أدخل الرقم أو المعرّف المحوّل منه');
  const original = num(body.amount);
  if (!(original > 0)) fail(400, 'أدخل مبلغ صحيح');
  const rate = num(settings.binance_rate, 11);
  const amount = money(method.crypto ? original * rate : original);
  const min = num(settings.min_deposit, 1);
  const max = num(settings.max_deposit, 20000);
  if (amount < min) fail(400, `أقل مبلغ للشحن ${min} د.ل`);
  if (amount > max) fail(400, `أكبر مبلغ للشحن ${max} د.ل`);

  const pending = await fs.query('deposits', [['userId', '==', user.uid], ['status', '==', 'pending']], { limit: 5 });
  if (pending.length >= 3) fail(429, 'عندك 3 طلبات شحن قيد المراجعة، استنى لين تتراجع', 'rate_limited');

  const userDoc = await fs.get(`users/${user.uid}`);
  if (!userDoc) fail(404, 'حسابك غير مكتمل');
  if (userDoc.data.isActive === false) fail(403, 'حسابك موقوف، تواصل مع الدعم');

  const id = randomId();
  const dep = {
    userId: user.uid, userName: userDoc.data.name || userDoc.data.username || user.email, userEmail: user.email,
    method: body.method, provider: method.title, [method.field]: value,
    amount, amountOriginal: money(original), currency: method.crypto ? 'USD' : 'LYD', rate: method.crypto ? rate : 1,
    invoiceNumber: invoiceNo('DP'), status: 'pending', createdAt: new Date(),
  };
  await fs.commit([fs.wCreate(`deposits/${id}`, dep)]);
  ctx.waitUntil(notifyStaff(env, fs, {
    title: '💰 طلب شحن جديد', body: `${dep.userName}: ${amount.toFixed(3)} د.ل عبر ${method.title}`, type: 'deposit',
  }));
  return { ok: true, id, invoiceNumber: dep.invoiceNumber, amount };
}

// ===== routes/push.js =====
// تسجيل أجهزة الإشعارات



async function registerPush(req, env, fs) {
  const user = await requireUser(req, env, fs, { verified: false });
  const body = await readJson(req);
  const token = str(body.token, 600);
  if (token.length < 20) fail(400, 'توكن غير صالح');
  const id = (await sha256Hex(token)).slice(0, 40);
  const staff = await fs.get(`admins/${user.uid}`);
  await fs.commit([fs.wSet(`push_tokens/${id}`, {
    token, uid: user.uid, isStaff: !!staff, ua: str(req.headers.get('User-Agent'), 160), updatedAt: new Date(),
  })]);
  return { ok: true };
}

async function unregisterPush(req, env, fs) {
  const user = await requireUser(req, env, fs, { verified: false });
  const body = await readJson(req);
  const token = str(body.token, 600);
  if (token) {
    const path = `push_tokens/${(await sha256Hex(token)).slice(0, 40)}`;
    const doc = await fs.get(path);
    if (doc && doc.data.uid === user.uid) await fs.commit([fs.wDelete(path)]);
  }
  return { ok: true };
}

// ===== routes/admin.js =====
// عمليات الإدارة اللي فيها فلوس أو تسليم (كلها بمعاملات + سجل عمليات)






function audit(t, staff, data) {
  t.create(`audit_logs/${randomId()}`, { by: staff.uid, byName: staff.staffName, at: new Date(), ...data });
}
const siteLink = (env, hash) => (env.SITE_URL ? `${env.SITE_URL}/#${hash}` : '');

// قبول طلب: تسليم يدوي (نص يكتبه الموظف) أو سحب تلقائي من المخزون
async function approveOrder(req, env, fs, ctx) {
  const staff = await requireStaff(req, env, fs, 'orders');
  const body = await readJson(req);
  const id = safeId(body.orderId, 80);
  const manual = str(body.deliveredData, 4000);
  const order = await fs.transaction(async (t) => {
    const o = await t.get(`orders/${id}`);
    if (!o) fail(404, 'الطلب غير موجود');
    if (o.data.status !== 'pending') fail(409, 'الطلب مش معلق');
    const now = new Date();
    const upd = { status: 'completed', approvedBy: staff.uid, approvedAt: now };
    if (manual) {
      Object.assign(upd, { deliveredData: manual, deliveredType: 'manual', deliveredAt: now });
    } else if (o.data.productId) {
      const p = await t.get(`products/${o.data.productId}`);
      if (p && p.data.deliveryType && p.data.deliveryType !== 'manual') {
        const need = p.data.enableQuantity === true ? 1 : Math.max(1, num(o.data.quantity, 1));
        const d = await allocateStock(t, p.data, o.data.productId, need, id, o.data.userId);
        if (!d) fail(409, 'المخزون ما يكفيش. أضف أكواد/حسابات أو اكتب بيانات التسليم يدوياً');
        Object.assign(upd, {
          deliveredData: d.data, deliveredType: d.type, deliveredAt: now, deliveredRefs: d.refs,
          deliveredAccountId: d.type === 'shared_account' ? d.refs[0] : null,
        });
      }
    }
    t.update(o.path, upd);
    audit(t, staff, { type: 'order_approved', orderId: id, userId: o.data.userId, amount: num(o.data.amount) });
    return { ...o.data, ...upd };
  });
  ctx.waitUntil(notifyUser(env, fs, order.userId, {
    title: '✅ تم تنفيذ طلبك', body: `${order.serviceName} — فاتورة ${order.invoiceNumber}`, type: 'order', link: siteLink(env, '/orders'),
  }));
  return { ok: true, deliveredData: order.deliveredData || null };
}

// إلغاء طلب مع إرجاع المبلغ للمحفظة
async function cancelOrder(req, env, fs, ctx) {
  const staff = await requireStaff(req, env, fs, 'orders');
  const body = await readJson(req);
  const id = safeId(body.orderId, 80);
  const reason = str(body.reason, 300);
  const res = await fs.transaction(async (t) => {
    const o = await t.get(`orders/${id}`);
    if (!o) fail(404, 'الطلب غير موجود');
    if (o.data.status === 'canceled' || o.data.status === 'refunded') fail(409, 'الطلب ملغي مسبقاً، ما يتسترجعش مرتين');
    const refund = money(o.data.amount ?? o.data.price);
    const now = new Date();
    let after = null;
    if (o.data.userId && refund > 0) {
      const u = await t.get(`users/${o.data.userId}`);
      if (u) {
        const before = money(u.data.balance);
        after = money(before + refund);
        t.update(u.path, { balance: after });
        t.create(`wallet_tx/refund-${id}`, {
          userId: o.data.userId, type: 'refund', amount: refund, balanceBefore: before, balanceAfter: after,
          ref: id, note: `استرجاع: ${o.data.serviceName || ''}`, createdAt: now,
        });
      }
    }
    // إرجاع خانات الحسابات المشتركة
    if (o.data.deliveredType === 'shared_account') {
      const refs = Array.isArray(o.data.deliveredRefs) && o.data.deliveredRefs.length ? o.data.deliveredRefs : [o.data.deliveredAccountId].filter(Boolean);
      const counts = {};
      refs.forEach((r) => { counts[r] = (counts[r] || 0) + 1; });
      for (const [accId, n] of Object.entries(counts)) {
        const a = await t.get(`shared_accounts/${accId}`);
        if (a) t.update(a.path, { usedSlots: Math.max(num(a.data.usedSlots) - n, 0), status: 'active' });
      }
    }
    t.update(o.path, { status: 'canceled', refunded: refund > 0, refundAmount: refund, cancelReason: reason, canceledBy: staff.uid, canceledAt: now });
    audit(t, staff, { type: 'order_refund', orderId: id, userId: o.data.userId || null, amount: refund, balanceAfter: after, reason });
    return { userId: o.data.userId, refund, name: o.data.serviceName, invoice: o.data.invoiceNumber };
  });
  if (res.userId) {
    ctx.waitUntil(notifyUser(env, fs, res.userId, {
      title: '↩️ تم إلغاء طلبك', body: `${res.name} — رجعنا ${res.refund.toFixed(3)} د.ل لمحفظتك${reason ? `. السبب: ${reason}` : ''}`, type: 'order', link: siteLink(env, '/wallet'),
    }));
  }
  return { ok: true, refund: res.refund };
}

async function approveDeposit(req, env, fs, ctx) {
  const staff = await requireStaff(req, env, fs, 'deposits');
  const body = await readJson(req);
  const id = safeId(body.depositId, 80);
  const override = body.amount !== undefined && body.amount !== '' ? money(body.amount) : null;
  const res = await fs.transaction(async (t) => {
    const d = await t.get(`deposits/${id}`);
    if (!d) fail(404, 'الإيداع غير موجود');
    if (d.data.status !== 'pending') fail(409, 'تم التعامل مع هذا الإيداع مسبقاً');
    const value = override ?? money(d.data.amount);
    if (!(value > 0) || value > 100000) fail(400, 'مبلغ غير صالح');
    const u = await t.get(`users/${d.data.userId}`);
    if (!u) fail(404, 'المستخدم غير موجود');
    const before = money(u.data.balance);
    const after = money(before + value);
    const now = new Date();
    t.update(u.path, { balance: after });
    t.update(d.path, { status: 'approved', approvedAmount: value, approvedBy: staff.uid, approvedAt: now });
    t.create(`wallet_tx/dep-${id}`, {
      userId: d.data.userId, type: 'deposit', amount: value, balanceBefore: before, balanceAfter: after,
      ref: id, note: `شحن عبر ${d.data.provider || ''}`, createdAt: now,
    });
    audit(t, staff, { type: 'deposit_approved', depositId: id, userId: d.data.userId, amount: value, balanceBefore: before, balanceAfter: after });
    return { userId: d.data.userId, value };
  });
  ctx.waitUntil(notifyUser(env, fs, res.userId, {
    title: '💰 تم شحن محفظتك', body: `تمت إضافة ${res.value.toFixed(3)} د.ل لرصيدك`, type: 'deposit', link: siteLink(env, '/wallet'),
  }));
  return { ok: true, amount: res.value };
}

async function rejectDeposit(req, env, fs, ctx) {
  const staff = await requireStaff(req, env, fs, 'deposits');
  const body = await readJson(req);
  const id = safeId(body.depositId, 80);
  const reason = str(body.reason, 300);
  const res = await fs.transaction(async (t) => {
    const d = await t.get(`deposits/${id}`);
    if (!d) fail(404, 'الإيداع غير موجود');
    if (d.data.status !== 'pending') fail(409, 'تم التعامل مع هذا الإيداع مسبقاً');
    t.update(d.path, { status: 'rejected', rejectReason: reason, rejectedBy: staff.uid, rejectedAt: new Date() });
    audit(t, staff, { type: 'deposit_rejected', depositId: id, userId: d.data.userId || null, reason });
    return { userId: d.data.userId, amount: num(d.data.amount) };
  });
  if (res.userId) {
    ctx.waitUntil(notifyUser(env, fs, res.userId, {
      title: '❌ تم رفض طلب الشحن', body: `طلب شحن ${res.amount.toFixed(3)} د.ل${reason ? ` — ${reason}` : ''}`, type: 'deposit', link: siteLink(env, '/wallet'),
    }));
  }
  return { ok: true };
}

// شحن/خصم يدوي
async function adjustWallet(req, env, fs, ctx) {
  const staff = await requireStaff(req, env, fs, 'wallet');
  const body = await readJson(req);
  const uid = safeId(body.userId, 128);
  const type = body.type === 'debit' ? 'debit' : 'credit';
  const amount = money(body.amount);
  const note = str(body.note, 200);
  if (!(amount > 0) || amount > 100000) fail(400, 'أدخل مبلغ صحيح');
  const res = await fs.transaction(async (t) => {
    const u = await t.get(`users/${uid}`);
    if (!u) fail(404, 'المستخدم غير موجود');
    const before = money(u.data.balance);
    if (type === 'debit' && before < amount) fail(400, `رصيد المستخدم ${before.toFixed(3)} فقط`);
    const after = money(type === 'credit' ? before + amount : before - amount);
    t.update(u.path, { balance: after });
    t.create(`wallet_tx/${randomId()}`, {
      userId: uid, type: type === 'credit' ? 'manual_credit' : 'manual_debit', amount: type === 'credit' ? amount : -amount,
      balanceBefore: before, balanceAfter: after, note: note || (type === 'credit' ? 'شحن من الإدارة' : 'خصم من الإدارة'), createdAt: new Date(),
    });
    audit(t, staff, { type: type === 'credit' ? 'manual_credit' : 'manual_debit', userId: uid, amount, balanceBefore: before, balanceAfter: after, note });
    return after;
  });
  if (body.notify !== false && type === 'credit') {
    ctx.waitUntil(notifyUser(env, fs, uid, { title: '💰 تم شحن محفظتك', body: `تمت إضافة ${amount.toFixed(3)} د.ل لرصيدك`, type: 'deposit', link: siteLink(env, '/wallet') }));
  }
  return { ok: true, balance: res };
}

// تفعيل/إيقاف حساب زبون
async function setUserActive(req, env, fs) {
  const staff = await requireStaff(req, env, fs, 'users');
  const body = await readJson(req);
  const uid = safeId(body.userId, 128);
  const active = body.active !== false;
  await fs.transaction(async (t) => {
    const u = await t.get(`users/${uid}`);
    if (!u) fail(404, 'المستخدم غير موجود');
    t.update(u.path, { isActive: active });
    audit(t, staff, { type: active ? 'user_activated' : 'user_suspended', userId: uid });
  });
  return { ok: true };
}

async function sendNotification(req, env, fs) {
  const staff = await requireStaff(req, env, fs, 'notify');
  const body = await readJson(req);
  const title = str(body.title, 80);
  const text = str(body.body, 300);
  if (!title || !text) fail(400, 'أدخل العنوان والنص');
  const link = str(body.link, 300);
  let sent;
  if (body.userId) {
    await notifyUser(env, fs, safeId(body.userId, 128), { title, body: text, link, type: 'admin' });
    sent = 1;
  } else {
    sent = await notifyAll(env, fs, { title, body: text, link });
  }
  await fs.commit([fs.wCreate(`audit_logs/${randomId()}`, { by: staff.uid, byName: staff.staffName, at: new Date(), type: 'notification_sent', title, target: body.userId || 'all' })]);
  return { ok: true, sent };
}

// إدارة الموظفين (المدير فقط)
async function upsertStaff(req, env, fs) {
  const staff = await requireStaff(req, env, fs, 'admin');
  const body = await readJson(req);
  const email = str(body.email, 120).toLowerCase();
  const role = body.role === 'admin' ? 'admin' : 'staff';
  const perms = {};
  for (const p of PERMS) perms[p] = role === 'admin' || body.perms?.[p] === true;
  let uid = safeId(body.uid, 128);
  if (!uid) {
    const u = await lookupUserByEmail(env, email);
    if (!u) fail(404, 'ما فيش حساب بهذا الإيميل. خلّي الموظف يسجّل في الموقع أولاً');
    uid = u.localId;
  }
  if (uid === staff.uid && role !== 'admin') fail(400, 'ما تقدرش تنزّل صلاحيتك بنفسك');
  await fs.commit([
    fs.wSet(`admins/${uid}`, { role, perms, name: str(body.name, 60) || email, email, updatedAt: new Date(), updatedBy: staff.uid }),
    fs.wCreate(`audit_logs/${randomId()}`, { by: staff.uid, byName: staff.staffName, at: new Date(), type: 'staff_saved', targetUid: uid, role }),
  ]);
  // تحديث علامة الموظف على أجهزته
  const tokens = await fs.query('push_tokens', [['uid', '==', uid]], { limit: 20 });
  if (tokens.length) await fs.commit(tokens.map((tk) => fs.wUpdate(tk.path, { isStaff: true })));
  return { ok: true, uid };
}

async function removeStaff(req, env, fs) {
  const staff = await requireStaff(req, env, fs, 'admin');
  const body = await readJson(req);
  const uid = safeId(body.uid, 128);
  if (!uid) fail(400, 'موظف غير محدد');
  if (uid === staff.uid) fail(400, 'ما تقدرش تحذف نفسك');
  const tokens = await fs.query('push_tokens', [['uid', '==', uid]], { limit: 20 });
  await fs.commit([
    fs.wDelete(`admins/${uid}`),
    ...tokens.map((tk) => fs.wUpdate(tk.path, { isStaff: false })),
    fs.wCreate(`audit_logs/${randomId()}`, { by: staff.uid, byName: staff.staffName, at: new Date(), type: 'staff_removed', targetUid: uid }),
  ]);
  return { ok: true };
}

// ===== index.js =====
// ميثاق | MITHAQ API — Cloudflare Worker
// المتغيرات المطلوبة: FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT (Secret), ALLOWED_ORIGINS, SITE_URL (اختياري)






const admin = { approveOrder, cancelOrder, approveDeposit, rejectDeposit, adjustWallet, setUserActive, sendNotification, upsertStaff, removeStaff };

const ROUTES = {
  'POST /v1/checkout': checkout,
  'POST /v1/coupon/check': checkCoupon,
  'POST /v1/deposit': createDeposit,
  'POST /v1/push/register': registerPush,
  'POST /v1/push/unregister': unregisterPush,
  'POST /v1/admin/orders/approve': admin.approveOrder,
  'POST /v1/admin/orders/cancel': admin.cancelOrder,
  'POST /v1/admin/deposits/approve': admin.approveDeposit,
  'POST /v1/admin/deposits/reject': admin.rejectDeposit,
  'POST /v1/admin/wallet': admin.adjustWallet,
  'POST /v1/admin/users/active': admin.setUserActive,
  'POST /v1/admin/notify': admin.sendNotification,
  'POST /v1/admin/staff': admin.upsertStaff,
  'POST /v1/admin/staff/remove': admin.removeStaff,
};

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  const ok = allowed.includes(origin) || (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && env.ALLOW_LOCALHOST === 'true');
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || 'null'),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers },
});

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/v1/health') {
      return json({ ok: true, service: 'mithaq-api', configured: !!env.FIREBASE_SERVICE_ACCOUNT }, 200, cors);
    }
    // رفض الطلبات من مواقع غريبة
    const origin = req.headers.get('Origin');
    if (origin && cors['Access-Control-Allow-Origin'] !== origin) {
      return json({ ok: false, error: 'مصدر غير مسموح', code: 'origin' }, 403, cors);
    }
    const handler = ROUTES[`${req.method} ${url.pathname}`];
    if (!handler) return json({ ok: false, error: 'غير موجود', code: 'not_found' }, 404, cors);
    try {
      const fs = new Firestore(env);
      const out = await handler(req, env, fs, ctx);
      return json(out, 200, cors);
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) return json({ ok: false, error: e.message, code: e.code }, e.status, cors);
      console.log('ERROR', url.pathname, e.stack || e.message);
      const msg = e instanceof ApiError && e.code === 'config' ? e.message : 'صار خطأ في السيرفر، حاول بعد شوية';
      return json({ ok: false, error: msg, code: 'server_error' }, 500, cors);
    }
  },
};
