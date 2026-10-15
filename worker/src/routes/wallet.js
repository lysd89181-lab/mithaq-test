// طلبات شحن المحفظة
import { requireUser, getSettings } from '../lib/context.js';
import { notifyStaff } from '../lib/notify.js';
import { fail, money, num, str, invoiceNo, randomId, readJson } from '../lib/util.js';

const METHODS = {
  libyana: { title: 'ليبيانا ومدار', field: 'phone' },
  binance: { title: 'بايننس', field: 'phone', crypto: true },
  cards: { title: 'كروت تعبئة', field: 'card_code' },
};

export async function createDeposit(req, env, fs, ctx) {
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
