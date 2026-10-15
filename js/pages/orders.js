// طلباتي
import { html, raw, copyText, fmtDate, statusOf } from '../core/utils.js';
import { icon, iconStr } from '../core/icons.js';
import { state, fmt } from '../core/state.js';
import { db, collection, query, where, limit, onSnapshot } from '../core/firebase.js';
import { toast, sheet } from '../core/ui.js';
import { pageHead, empty } from '../components/blocks.js';

const TABS = [
  { id: 'all', label: 'الكل' },
  { id: 'pending', label: 'قيد التنفيذ' },
  { id: 'completed', label: 'مكتملة' },
  { id: 'canceled', label: 'ملغية' },
];

export default async function page(el) {
  let tab = 'all';
  let orders = [];
  el.innerHTML = html`<div class="page">${raw(pageHead('طلباتي'))}
    <div class="segmented" style="margin-bottom:16px">${TABS.map((t) => html`<button data-t="${t.id}" class="${t.id === tab ? 'active' : ''}">${t.label}</button>`)}</div>
    <div id="list" class="stack"><div class="skel" style="height:110px"></div><div class="skel" style="height:110px"></div></div></div>`.html;

  const draw = () => {
    const list = orders.filter((o) => tab === 'all' || o.status === tab || (tab === 'canceled' && o.status === 'refunded'));
    el.querySelector('#list').innerHTML = list.length ? list.map((o) => {
      const st = statusOf(o.status);
      return html`<button class="order-card" data-id="${o.id}">
        <div class="row between"><b>${o.serviceName || o.cardName || 'طلب'}</b><span class="badge ${st.cls}">${st.label}</span></div>
        <div class="meta"><span class="num">${o.invoiceNumber || ''}</span><span>${fmtDate(o.createdAt)}</span><span>الكمية ${Number(o.quantity) || 1}</span></div>
        <div class="row between"><span class="hint">${o.status === 'completed' && o.deliveredData ? 'اضغط لعرض الكود' : o.playerID || ''}</span><b class="num">${fmt(o.amount ?? o.price)}</b></div>
      </button>`.html;
    }).join('') : empty('receipt', tab === 'all' ? 'ما عندكش طلبات بعد' : 'ما فيش طلبات هنا', '', tab === 'all' ? '<a class="btn btn-primary" href="#/categories">ابدأ التسوق</a>' : '');
  };

  el.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { tab = b.dataset.t; el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('active', x === b)); draw(); }; });
  el.querySelector('#list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const o = orders.find((x) => x.id === b.dataset.id);
    if (o) detail(o);
  });

  const unsub = onSnapshot(query(collection(db, 'orders'), where('userId', '==', state.user.uid), limit(200)), (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    draw();
  }, () => { el.querySelector('#list').innerHTML = empty('alert', 'تعذر تحميل الطلبات', 'حدّث الصفحة وحاول مرة أخرى.'); });
  return unsub;
}

function detail(o) {
  const st = statusOf(o.status);
  const s = sheet('تفاصيل الطلب', html`<div class="stack">
    <div class="row between"><b>${o.serviceName || o.cardName}</b><span class="badge ${st.cls}">${st.label}</span></div>
    <div class="list">
      <div class="list-row"><span class="grow muted">رقم الفاتورة</span><span class="num">${o.invoiceNumber || '—'}</span></div>
      <div class="list-row"><span class="grow muted">التاريخ</span><span>${fmtDate(o.createdAt)}</span></div>
      <div class="list-row"><span class="grow muted">البيانات</span><span class="num">${o.playerID || '—'}</span></div>
      <div class="list-row"><span class="grow muted">الكمية</span><span class="num">${Number(o.quantity) || 1}</span></div>
      ${o.discount ? html`<div class="list-row"><span class="grow muted">الخصم</span><span class="num">${fmt(o.discount)}</span></div>` : ''}
      <div class="list-row"><span class="grow muted">المدفوع</span><b class="num">${fmt(o.amount ?? o.price)}</b></div>
    </div>
    ${o.status === 'completed' && o.deliveredData ? html`<span class="label-text">بيانات التسليم</span>
      <div class="code-box"><pre>${o.deliveredData}</pre><button class="icon-btn" id="oCopy" aria-label="نسخ">${icon('copy')}</button></div>` : ''}
    ${o.status === 'pending' ? html`<div class="banner info">${icon('clock')}<span>طلبك في الطابور. نبلغوك بإشعار أول ما يتنفذ.</span></div>` : ''}
    ${o.status === 'canceled' ? html`<div class="banner info">${icon('refresh')}<span>تم إرجاع ${fmt(o.refundAmount ?? o.amount)} لمحفظتك${o.cancelReason ? ` — ${o.cancelReason}` : ''}</span></div>` : ''}
    <a class="btn btn-ghost" href="#/support" data-close>${icon('headset')}<span>مشكلة في الطلب؟ كلّم الدعم</span></a>
  </div>`.html);
  const c = s.el.querySelector('#oCopy');
  if (c) c.onclick = async () => { if (await copyText(o.deliveredData)) { c.innerHTML = iconStr('check'); toast('تم النسخ'); } };
}
