// أدوات عامة للسيرفر

export class ApiError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status, message, code) => { throw new ApiError(status, message, code); };

// تقريب المبالغ لـ 3 خانات (الدينار الليبي)
export const money = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export const num = (v, def = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
};

export const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

export function invoiceNo(prefix = 'MQ') {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const rnd = crypto.getRandomValues(new Uint32Array(1))[0] % 90000 + 10000;
  return `${prefix}-${ymd}-${rnd}`;
}

export function randomId(len = 20) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => abc[x % abc.length]).join('');
}

// معرّف آمن للمستندات من نص يرسله العميل
export const safeId = (s, max = 60) => str(s, max).replace(/[^A-Za-z0-9_-]/g, '');

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readJson(req) {
  try {
    const t = await req.text();
    if (t.length > 50000) fail(413, 'الطلب كبير جداً');
    return t ? JSON.parse(t) : {};
  } catch (e) {
    if (e instanceof ApiError) throw e;
    fail(400, 'صيغة الطلب غير صحيحة');
  }
}
