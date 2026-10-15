// الاتصال بالسيرفر (Cloudflare Worker) — كل العمليات المالية تمر من هنا
import { API_BASE } from './config.js';
import { auth } from './firebase.js';

export class ApiError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

export async function api(path, body = {}) {
  if (API_BASE.includes('YOUR-SUBDOMAIN')) throw new ApiError('السيرفر غير مربوط بعد (API_BASE في config.js)', 'config');
  const user = auth.currentUser;
  if (!user) throw new ApiError('سجل دخولك أولاً', 'unauthenticated', 401);
  const send = async (force) => fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken(force)}` },
    body: JSON.stringify(body),
  });
  let res;
  try {
    res = await send(false);
    // لو التوكن قديم (مثلاً بعد تأكيد البريد) نجدده ونعيد مرة وحدة
    if (res.status === 401 || res.status === 403) {
      const peek = await res.clone().json().catch(() => ({}));
      if (peek.code === 'unauthenticated' || peek.code === 'email_not_verified') res = await send(true);
    }
  } catch {
    throw new ApiError('تعذر الاتصال بالسيرفر، تأكد من الإنترنت', 'network');
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new ApiError(out.error || 'صار خطأ، حاول مرة أخرى', out.code, res.status);
  return out;
}
