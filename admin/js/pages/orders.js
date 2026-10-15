// إدارة الطلبات
import { db, collection, query, where, orderBy, limit, onSnapshot, doc, deleteDoc } from '../../../js/core/firebase.js';
import { html, raw, fmtDate, copyText, debounce } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { api } from '../../../js/core/api.js';
import { toast, toastErr, sheet, confirmBox, withLoading } from '../../../js/core/ui.js';
import { lyd, badge, tsMs, emptyRow, downloadCsv, audit } from '../kit.js';
import { me } from '../session.js';

const TABS = [['pending', 'المعلقة'], ['completed', 'المكتملة'], ['canceled', 'الملغية'], ['all', 'الكل']];

export default async function page(el) {
  let tab = 'pending';
  let size = 100;
  let rows = [];
  let term = '';
  let unsub = null;

  el.innerHTML = html`<section class="stack">
    <div class="toolbar">
      <div class="segmented">${TABS.map(([id, l]) => html`<button data-t="${id}" class="${id === tab ? 'active' : ''}">${l}</button>`)}</div>
      <div class="input-wrap">${icon('search')}<input class="input" id="q" placeholder="رقم الفاتورة، المستخدم، المنتج، البيانات"></div>
      <button class="btn btn-ghost btn-sm" id="csv">${icon('download', 'sm')}<span>تصدير</span></button>
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>الفاتورة</th><th>المستخدم</th><th>المنتج</th><th>البيانات</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead>
      <tbody id="tb">${raw(emptyRow(8, 'جاري التحميل…'))}</tbody></table>
      <div class="pager" id="more" hidden><button class="btn btn-ghost btn-sm">تحميل المزيد</button></div></div>
  </section>`.html;

  const listen = () => {
    unsub && unsub();
    const q = tab === 'all'
      ? query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(size))
      : query(collection(db, 'orders'), where('status', '==', tab), limit(tab === 'pending' ? 500 : size));
    unsub = onSnapshot(q, (s) => {
      rows = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (tab === 'pending' ? tsMs(a.createdAt) - tsMs(b.createdAt) : tsMs(b.createdAt) - tsMs(a.createdAt)));
      el.querySelector('#more').hidden = s.size < size || tab === 'pending';
      draw();
    }, (e) => { el.querySelector('#tb').innerHTML = emptyRow(8, `تعذر التحميل: ${e.message}`); });
  };

  const match = (o) => !term || [o.invoiceNumber, o.userName, o.userEmail, o.serviceName, o.playerID, o.contactPhone].some((v) => String(v || '').toLowerCase().includes(term));
  function draw() {
    const list = rows.filter(match);
    el.querySelector('#tb').innerHTML = list.length ? list.map((o) => html`<tr>
      <td data-label="الفاتورة" class="num hint">${o.invoiceNumber || o.id.slice(0, 8)}</td>
      <td data-label="المستخدم"><div class="strong">${o.userName || '—'}</div><div class="hint num">${o.contactPhone || ''}</div></td>
      <td data-label="المنتج" class="full"><span class="strong">${o.serviceName || o.cardName || '—'}</span> <span class="hint">× ${Number(o.quantity) || 1}</span></td>
      <td data-label="البيانات" class="num" style="max-width:180px;overflow-wrap:anywhere">${o.playerID || '—'}</td>
      <td data-label="المبلغ" class="num strong">${lyd(o.amount ?? o.price)}</td>
      <td data-label="الحالة">${badge(o.status)}</td>
      <td data-label="التاريخ" class="hint">${fmtDate(o.createdAt)}</td>
      <td class="acts-cell"><div class="acts">
        ${o.status === 'pending' ? html`<button class="btn btn-success btn-sm" data-ok="${o.id}">${icon('check', 'sm')}<span>تنفيذ</span></button>` : ''}
        <button class="btn btn-ghost btn-sm" data-view="${o.id}">التفاصيل</button></div></td>
    </tr>`.html).join('') : emptyRow(8, tab === 'pending' ? 'ما فيش طلبات معلقة. شغل ممتاز.' : 'ما فيش طلبات');
  }

  el.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { tab = b.dataset.t; size = 100; el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('active', x === b)); listen(); }; });
  el.querySelector('#q').oninput = debounce((e) => { term = e.target.value.trim().toLowerCase(); draw(); }, 200);
  el.querySelector('#more button').onclick = () => { size += 100; listen(); };
  el.querySelector('#csv').onclick = () => downloadCsv(`orders-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['الفاتورة', 'المستخدم', 'البريد', 'الهاتف', 'المنتج', 'الكمية', 'البيانات', 'المبلغ', 'الخصم', 'الحالة', 'التاريخ'],
    ...rows.filter(match).map((o) => [o.invoiceNumber, o.userName, o.userEmail, o.contactPhone, o.serviceName, o.quantity, o.playerID, o.amount ?? o.price, o.discount || 0, o.status, fmtDate(o.createdAt)]),
  ]);
  el.querySelector('#tb').addEventListener('click', (e) => {
    const ok = e.target.closest('[data-ok]');
    const v = e.target.closest('[data-view]');
    const o = rows.find((x) => x.id === (ok || v)?.dataset[ok ? 'ok' : 'view']);
    if (!o) return;
    if (ok) approve(o); else details(o);
  });

  listen();
  return () => unsub && unsub();
}

function approve(o) {
  const auto = o.deliveryType && o.deliveryType !== 'manual';
  const s = sheet('تنفيذ الطلب', html`<form class="stack" id="f">
    <div class="banner info"><span class="grow"><b>${o.serviceName}</b> × ${Number(o.quantity) || 1}</span><b class="num">${lyd(o.amount ?? o.price)}</b></div>
    <div class="list-row"><span class="grow muted">البيانات</span><span class="num">${o.playerID || '—'}</span><button type="button" class="icon-btn" id="cp" aria-label="نسخ">${icon('copy', 'sm')}</button></div>
    <div class="field"><label for="dd">بيانات التسليم للزبون (كود، حساب، ملاحظة)</label>
      <textarea id="dd" class="textarea ltr" dir="ltr" placeholder="${auto ? 'اتركه فاضي للسحب التلقائي من المخزون' : 'اختياري: مثلاً كود البطاقة أو رسالة تم الشحن'}"></textarea>
      <span class="hint">${auto ? 'لو تركته فاضي، يتسحب كود من المخزون ويتسلم للزبون تلقائياً.' : 'الزبون يشوف النص هذا في طلباته ويوصله إشعار.'}</span></div>
    <button class="btn btn-success btn-block"><span class="label">تأكيد التنفيذ</span><span class="spin"></span></button></form>`.html);
  s.el.querySelector('#cp').onclick = async () => { if (await copyText(o.playerID || '')) toast('تم النسخ'); };
  s.el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    withLoading(e.target.querySelector('button.btn'), async () => {
      try {
        await api('/v1/admin/orders/approve', { orderId: o.id, deliveredData: s.el.querySelector('#dd').value.trim() });
        toast('تم تنفيذ الطلب وتبليغ الزبون');
        s.close();
      } catch (err) { toastErr(err); }
    });
  };
}

function details(o) {
  const s = sheet('تفاصيل الطلب', html`<div class="stack">
    <div class="row between"><b>${o.serviceName || o.cardName}</b>${badge(o.status)}</div>
    <div class="list">
      ${[['الفاتورة', o.invoiceNumber], ['المستخدم', `${o.userName || ''} ${o.userEmail ? `(${o.userEmail})` : ''}`], ['هاتف التواصل', o.contactPhone], ['البيانات', o.playerID],
        ['الكمية', o.quantity || 1], ['السعر قبل الخصم', o.subtotal ? lyd(o.subtotal) : ''], ['الخصم', o.discount ? `${lyd(o.discount)} ${o.couponCode ? `(${o.couponCode})` : ''}` : ''],
        ['المدفوع', lyd(o.amount ?? o.price)], ['التاريخ', fmtDate(o.createdAt)], ['سبب الإلغاء', o.cancelReason]]
        .filter(([, v]) => v).map(([k, v]) => html`<div class="list-row"><span class="grow muted">${k}</span><span class="num" style="text-align:left;overflow-wrap:anywhere">${v}</span></div>`)}
    </div>
    ${o.deliveredData ? html`<span class="label-text">ما تم تسليمه</span><div class="code-box"><pre>${o.deliveredData}</pre></div>` : ''}
    <div class="row" style="flex-wrap:wrap">
      ${o.status === 'pending' ? html`<button class="btn btn-success" style="flex:1" data-close id="dOk">تنفيذ</button>` : ''}
      ${o.status !== 'canceled' && o.status !== 'refunded' ? html`<button class="btn btn-danger" style="flex:1" id="dCancel">إلغاء وإرجاع المبلغ</button>` : ''}
      ${me.role === 'admin' ? html`<button class="btn btn-ghost" id="dDel">${icon('trash', 'sm')}<span>حذف</span></button>` : ''}
    </div></div>`.html);
  const q = (x) => s.el.querySelector(x);
  if (q('#dOk')) q('#dOk').onclick = () => setTimeout(() => approve(o), 50);
  if (q('#dCancel')) {
    q('#dCancel').onclick = async () => {
      const reason = await confirmBox('إلغاء الطلب', `يرجع ${lyd(o.amount ?? o.price)} لمحفظة الزبون ويوصله إشعار.`, { ok: 'إلغاء وإرجاع', danger: true, input: { label: 'السبب (يظهر للزبون)', placeholder: 'مثلاً: ID غير صحيح' } });
      if (reason === null) return;
      try { const r = await api('/v1/admin/orders/cancel', { orderId: o.id, reason }); toast(`تم الإلغاء وإرجاع ${lyd(r.refund)}`); s.close(); } catch (err) { toastErr(err); }
    };
  }
  if (q('#dDel')) {
    q('#dDel').onclick = async () => {
      if (!(await confirmBox('حذف الطلب', 'الحذف نهائي ومش يرجع الفلوس. للإرجاع استخدم الإلغاء.', { ok: 'حذف نهائي', danger: true }))) return;
      try { await deleteDoc(doc(db, 'orders', o.id)); audit('order_deleted', { orderId: o.id, amount: o.amount ?? o.price }); toast('تم الحذف'); s.close(); } catch (err) { toastErr(err); }
    };
  }
}
