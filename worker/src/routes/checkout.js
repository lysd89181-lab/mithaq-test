// الشراء: السلة كاملة في معاملة وحدة (السعر من القاعدة، الرصيد، الكوبون، التسليم التلقائي)
import { requireUser, productPricing, lineTotal } from '../lib/context.js';
import { evaluateCoupon, couponUseId, normalizeCode } from './coupons.js';
import { notifyStaff, notifyUser } from '../lib/notify.js';
import { fail, money, num, str, safeId, invoiceNo, readJson } from '../lib/util.js';

const MAX_ITEMS = 20;

// سحب أكواد/حسابات من المخزون داخل المعاملة. يرجّع null لو المخزون ما يكفيش
export async function allocateStock(t, product, productId, need, orderId, uid) {
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

export async function checkout(req, env, fs, ctx) {
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
