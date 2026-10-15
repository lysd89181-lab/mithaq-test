// عمليات الإدارة اللي فيها فلوس أو تسليم (كلها بمعاملات + سجل عمليات)
import { requireStaff, PERMS } from '../lib/context.js';
import { lookupUserByEmail } from '../lib/google.js';
import { notifyUser, notifyAll } from '../lib/notify.js';
import { allocateStock } from './checkout.js';
import { fail, money, num, str, safeId, randomId, readJson } from '../lib/util.js';

function audit(t, staff, data) {
  t.create(`audit_logs/${randomId()}`, { by: staff.uid, byName: staff.staffName, at: new Date(), ...data });
}
const siteLink = (env, hash) => (env.SITE_URL ? `${env.SITE_URL}/#${hash}` : '');

// قبول طلب: تسليم يدوي (نص يكتبه الموظف) أو سحب تلقائي من المخزون
export async function approveOrder(req, env, fs, ctx) {
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
export async function cancelOrder(req, env, fs, ctx) {
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

export async function approveDeposit(req, env, fs, ctx) {
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

export async function rejectDeposit(req, env, fs, ctx) {
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
export async function adjustWallet(req, env, fs, ctx) {
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
export async function setUserActive(req, env, fs) {
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

export async function sendNotification(req, env, fs) {
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
export async function upsertStaff(req, env, fs) {
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

export async function removeStaff(req, env, fs) {
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
