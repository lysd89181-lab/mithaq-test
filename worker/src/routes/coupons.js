// الكوبونات
import { requireUser, lineTotal } from '../lib/context.js';
import { fail, money, num, readJson, safeId } from '../lib/util.js';

export const normalizeCode = (c) => safeId(String(c || '').toUpperCase(), 30);
export const couponUseId = (code, uid) => `${code}_${uid}`;

// يحسب الخصم أو يرمي خطأ بسبب واضح
export function evaluateCoupon(c, uses, subtotal) {
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

export async function checkCoupon(req, env, fs) {
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
