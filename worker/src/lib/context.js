// هوية المستخدم وصلاحياته + إعدادات المتجر
import { verifyIdToken } from './google.js';
import { fail, money, num } from './util.js';

export const PERMS = ['orders', 'deposits', 'products', 'stock', 'users', 'wallet', 'coupons', 'reports', 'notify', 'settings', 'audit'];

let settingsCache = { data: null, exp: 0 };
export async function getSettings(fs) {
  if (settingsCache.data && settingsCache.exp > Date.now()) return settingsCache.data;
  const doc = await fs.get('app/settings');
  settingsCache = { data: doc?.data || {}, exp: Date.now() + 30_000 };
  return settingsCache.data;
}

export async function requireUser(req, env, fs, { verified = true } = {}) {
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

export async function requireStaff(req, env, fs, perm) {
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
export function productPricing(p) {
  const base = num(p.priceLYD ?? p.price);
  const discount = Math.min(Math.max(num(p.discount), 0), 99);
  const final = discount > 0 ? base - (base * discount) / 100 : base;
  const qtyMode = p.enableQuantity === true;
  const qtyMin = qtyMode ? Math.max(1, Math.floor(num(p.qtyMin, 1))) : 1;
  const qtyMax = qtyMode ? Math.max(qtyMin, Math.floor(num(p.qtyMax, 100))) : 10;
  return { base, final, qtyMode, qtyMin, qtyMax, unit: qtyMode ? final / qtyMin : final };
}

export function lineTotal(p, qty) {
  const pr = productPricing(p);
  return money(pr.unit * qty);
}
