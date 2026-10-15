// المصادقة مع قوقل: توكن حساب الخدمة + التحقق من توكن المستخدم (Firebase ID Token)
import { fail } from './util.js';

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
export function serviceAccount(env) {
  if (saCache) return saCache;
  if (!env.FIREBASE_SERVICE_ACCOUNT) fail(500, 'السيرفر غير مُعد: FIREBASE_SERVICE_ACCOUNT ناقص', 'config');
  try {
    saCache = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    fail(500, 'FIREBASE_SERVICE_ACCOUNT ليس JSON صحيح', 'config');
  }
  return saCache;
}

export const projectId = (env) => env.FIREBASE_PROJECT_ID || serviceAccount(env).project_id;

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
export async function accessToken(env) {
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

export async function verifyIdToken(env, token) {
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
export async function lookupUserByEmail(env, email) {
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
