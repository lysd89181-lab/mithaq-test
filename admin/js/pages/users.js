// المستخدمين
import { db, collection, query, limit, getDocs, where, doc, getDoc } from '../../../js/core/firebase.js';
import { html, raw, fmtDate, debounce, statusOf } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { api } from '../../../js/core/api.js';
import { toast, toastErr, sheet, confirmBox, withLoading } from '../../../js/core/ui.js';
import { lyd, tsMs, emptyRow, downloadCsv } from '../kit.js';
import { can } from '../session.js';

const TX = { deposit: 'شحن', purchase: 'شراء', refund: 'استرجاع', manual_credit: 'إضافة يدوية', manual_debit: 'خصم يدوي' };

export default async function page(el) {
  let users = [];
  let term = '';
  let size = 300;
  el.innerHTML = html`<section class="stack">
    <div class="toolbar"><div class="input-wrap">${icon('search')}<input class="input" id="q" placeholder="الاسم، البريد، الهاتف، المعرّف"></div>
      <select class="select" id="sort" style="width:auto"><option value="new">الأحدث</option><option value="bal">الأعلى رصيداً</option></select>
      <button class="btn btn-ghost btn-sm" id="csv">${icon('download', 'sm')}<span>تصدير</span></button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>المستخدم</th><th>الهاتف</th><th>الرصيد</th><th>التسجيل</th><th>الحالة</th><th></th></tr></thead>
    <tbody id="tb">${raw(emptyRow(6, 'جاري التحميل…'))}</tbody></table><div class="pager" id="more"><button class="btn btn-ghost btn-sm">تحميل المزيد</button></div></div></section>`.html;

  async function load() {
    const s = await getDocs(query(collection(db, 'users'), limit(size)));
    users = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    el.querySelector('#more').hidden = s.size < size;
    draw();
  }
  function draw() {
    const sort = el.querySelector('#sort').value;
    const list = users.filter((u) => !term || [u.name, u.username, u.email, u.phone, u.id].some((v) => String(v || '').toLowerCase().includes(term)))
      .sort((a, b) => (sort === 'bal' ? (Number(b.balance) || 0) - (Number(a.balance) || 0) : tsMs(b.createdAt) - tsMs(a.createdAt)));
    el.querySelector('#tb').innerHTML = list.length ? list.slice(0, 300).map((u) => html`<tr>
      <td data-label="المستخدم" class="full"><div class="strong">${u.name || u.username || '—'}</div><div class="hint ltr" style="text-align:right">${u.email || ''}</div></td>
      <td data-label="الهاتف" class="num">${u.phone || '—'}</td>
      <td data-label="الرصيد" class="num strong">${lyd(u.balance)}</td>
      <td data-label="التسجيل" class="hint">${fmtDate(u.createdAt, false)}</td>
      <td data-label="الحالة">${u.isActive === false ? html`<span class="badge bad">موقوف</span>` : html`<span class="badge ok">نشط</span>`}</td>
      <td class="acts-cell"><div class="acts"><button class="btn btn-ghost btn-sm" data-open="${u.id}">فتح</button></div></td></tr>`.html).join('') : emptyRow(6, 'ما فيش نتائج');
  }
  el.querySelector('#q').oninput = debounce((e) => { term = e.target.value.trim().toLowerCase(); draw(); }, 200);
  el.querySelector('#sort').onchange = draw;
  el.querySelector('#more button').onclick = () => { size += 300; load(); };
  el.querySelector('#csv').onclick = () => downloadCsv(`users-${new Date().toISOString().slice(0, 10)}.csv`, [['الاسم', 'البريد', 'الهاتف', 'الرصيد', 'التسجيل', 'المعرف'], ...users.map((u) => [u.name, u.email, u.phone, u.balance, fmtDate(u.createdAt), u.id])]);
  el.querySelector('#tb').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openUser(b.dataset.open, load); });
  await load();
}

async function openUser(uid, reload) {
  const [u, orders, txs] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDocs(query(collection(db, 'orders'), where('userId', '==', uid), limit(100))).catch(() => null),
    getDocs(query(collection(db, 'wallet_tx'), where('userId', '==', uid), limit(100))).catch(() => null),
  ]);
  if (!u.exists()) return toast('المستخدم غير موجود', 'err');
  const d = u.data();
  const os = orders ? orders.docs.map((x) => x.data()).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt)) : [];
  const ts = txs ? txs.docs.map((x) => x.data()).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt)) : [];
  const spent = os.filter((o) => o.status === 'completed').reduce((s, o) => s + (Number(o.amount ?? o.price) || 0), 0);
  const s = sheet(d.name || d.email || 'مستخدم', html`<div class="stack">
    <div class="balance-card" style="padding:18px"><span class="muted">الرصيد</span><div class="amount num" style="font-size:var(--fs-2xl)">${lyd(d.balance)}</div>
      <div class="hint">${d.email || ''} · ${d.phone || 'بدون هاتف'} · مشتريات ${lyd(spent)}</div></div>
    ${can('wallet') ? html`<form class="form-section" id="w"><h4>شحن أو خصم يدوي</h4>
      <div class="split even"><input class="input ltr" dir="ltr" type="number" step="0.001" min="0.001" id="amt" placeholder="المبلغ" required>
      <input class="input" id="note" placeholder="ملاحظة (تظهر للزبون)" maxlength="200"></div>
      <div class="row"><button class="btn btn-success" style="flex:1" data-type="credit"><span class="label">إضافة</span><span class="spin"></span></button>
      <button class="btn btn-danger" style="flex:1" data-type="debit"><span class="label">خصم</span><span class="spin"></span></button></div></form>` : ''}
    <div class="row"><button class="btn btn-ghost" style="flex:1" id="susp">${d.isActive === false ? 'تفعيل الحساب' : 'إيقاف الحساب'}</button>
      <button class="btn btn-ghost" style="flex:1" id="cpId">${icon('copy', 'sm')}<span>نسخ المعرّف</span></button></div>
    <div class="segmented"><button class="active" data-tab="o">الطلبات (${os.length})</button><button data-tab="t">المعاملات (${ts.length})</button></div>
    <div id="uTab"></div></div>`.html, { wide: true });

  const tab = (t) => {
    s.el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    s.el.querySelector('#uTab').innerHTML = t === 'o'
      ? (os.length ? html`<div class="list">${os.slice(0, 50).map((o) => { const st = statusOf(o.status); return html`<div class="list-row"><div class="grow"><div class="title" style="font-size:var(--fs-sm)">${o.serviceName}</div><div class="sub num">${o.invoiceNumber || ''} · ${fmtDate(o.createdAt)}</div></div><span class="badge ${st.cls}">${st.label}</span><b class="num">${lyd(o.amount ?? o.price)}</b></div>`; })}</div>`.html : '<p class="muted">ما فيش طلبات.</p>')
      : (ts.length ? html`<div class="list">${ts.slice(0, 50).map((x) => html`<div class="list-row"><div class="grow"><div class="title" style="font-size:var(--fs-sm)">${TX[x.type] || x.type}</div><div class="sub">${x.note || ''} · ${fmtDate(x.createdAt)}</div></div><b class="num" style="color:${x.amount > 0 ? 'var(--ok)' : 'var(--paper)'}">${x.amount > 0 ? '+' : ''}${lyd(x.amount)}</b><span class="hint num">${lyd(x.balanceAfter)}</span></div>`)}</div>`.html : '<p class="muted">ما فيش معاملات مسجلة (المعاملات قبل المنصة الجديدة ما تظهرش).</p>');
  };
  s.el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => tab(b.dataset.tab); });
  tab('o');

  const w = s.el.querySelector('#w');
  if (w) {
    w.addEventListener('click', (e) => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      e.preventDefault();
      const amount = Number(w.querySelector('#amt').value);
      if (!(amount > 0)) return toast('أدخل المبلغ', 'err');
      const type = b.dataset.type;
      withLoading(b, async () => {
        if (!(await confirmBox(type === 'credit' ? 'تأكيد الإضافة' : 'تأكيد الخصم', `${type === 'credit' ? 'إضافة' : 'خصم'} ${lyd(amount)} ${type === 'credit' ? 'إلى' : 'من'} رصيد ${d.name || d.email}`))) return;
        try {
          const r = await api('/v1/admin/wallet', { userId: uid, type, amount, note: w.querySelector('#note').value.trim() });
          toast(`تم. الرصيد الجديد ${lyd(r.balance)}`);
          s.close();
          reload();
        } catch (err) { toastErr(err); }
      });
    });
  }
  s.el.querySelector('#cpId').onclick = async () => { await navigator.clipboard?.writeText(uid); toast('تم النسخ'); };
  s.el.querySelector('#susp').onclick = async () => {
    const active = d.isActive === false;
    if (!(await confirmBox(active ? 'تفعيل الحساب' : 'إيقاف الحساب', active ? 'يرجع يقدر يشتري ويشحن.' : 'ما يقدرش يشتري ولا يشحن لين تفعله.', { ok: active ? 'تفعيل' : 'إيقاف', danger: !active }))) return;
    try { await api('/v1/admin/users/active', { userId: uid, active }); toast(active ? 'تم التفعيل' : 'تم الإيقاف'); s.close(); reload(); } catch (err) { toastErr(err); }
  };
}
