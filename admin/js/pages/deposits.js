// إدارة الإيداعات
import { db, collection, query, where, orderBy, limit, onSnapshot } from '../../../js/core/firebase.js';
import { html, raw, fmtDate, copyText } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { api } from '../../../js/core/api.js';
import { toast, toastErr, sheet, confirmBox, withLoading } from '../../../js/core/ui.js';
import { lyd, badge, tsMs, emptyRow } from '../kit.js';

const TABS = [['pending', 'المعلقة'], ['approved', 'المقبولة'], ['rejected', 'المرفوضة'], ['all', 'الكل']];
const MI = { libyana: 'phone', binance: 'coin', cards: 'card' };

export default async function page(el) {
  let tab = 'pending';
  let rows = [];
  let unsub = null;
  el.innerHTML = html`<section class="stack">
    <div class="toolbar"><div class="segmented">${TABS.map(([id, l]) => html`<button data-t="${id}" class="${id === tab ? 'active' : ''}">${l}</button>`)}</div></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>المستخدم</th><th>الطريقة</th><th>الرقم / الكود</th><th>المبلغ</th><th>الفاتورة</th><th>التاريخ</th><th>الحالة</th><th></th></tr></thead>
    <tbody id="tb">${raw(emptyRow(8, 'جاري التحميل…'))}</tbody></table></div></section>`.html;

  const listen = () => {
    unsub && unsub();
    const q = tab === 'all' ? query(collection(db, 'deposits'), orderBy('createdAt', 'desc'), limit(150)) : query(collection(db, 'deposits'), where('status', '==', tab), limit(300));
    unsub = onSnapshot(q, (s) => {
      rows = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (tab === 'pending' ? tsMs(a.createdAt) - tsMs(b.createdAt) : tsMs(b.createdAt) - tsMs(a.createdAt)));
      draw();
    }, (e) => { el.querySelector('#tb').innerHTML = emptyRow(8, e.message); });
  };
  function draw() {
    el.querySelector('#tb').innerHTML = rows.length ? rows.map((d) => html`<tr>
      <td data-label="المستخدم"><div class="strong">${d.userName || d.userId}</div><div class="hint ltr" style="text-align:right">${d.userEmail || ''}</div></td>
      <td data-label="الطريقة"><span class="row" style="gap:6px">${icon(MI[d.method] || 'wallet', 'sm')}${d.provider || 'تحويل'}</span></td>
      <td data-label="الرقم / الكود" class="num strong" style="overflow-wrap:anywhere">${d.phone || d.card_code || '—'}</td>
      <td data-label="المبلغ"><div class="num strong">${lyd(d.amount)}</div>${d.currency === 'USD' ? html`<div class="hint num">$${d.amountOriginal}</div>` : ''}</td>
      <td data-label="الفاتورة" class="num hint">${d.invoiceNumber || ''}</td>
      <td data-label="التاريخ" class="hint">${fmtDate(d.createdAt)}</td>
      <td data-label="الحالة">${badge(d.status)}</td>
      <td class="acts-cell"><div class="acts">${d.status === 'pending' ? html`
        <button class="btn btn-success btn-sm" data-ok="${d.id}">قبول</button><button class="btn btn-danger btn-sm" data-no="${d.id}">رفض</button>
        <button class="icon-btn" data-cp="${d.phone || d.card_code || ''}" aria-label="نسخ">${icon('copy', 'sm')}</button>` : html`<span class="hint">${d.status === 'approved' && d.approvedAmount ? lyd(d.approvedAmount) : d.rejectReason || ''}</span>`}</div></td>
    </tr>`.html).join('') : emptyRow(8, tab === 'pending' ? 'ما فيش إيداعات تستنى' : 'ما فيش إيداعات');
  }
  el.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { tab = b.dataset.t; el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('active', x === b)); listen(); }; });
  el.querySelector('#tb').addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-cp]');
    if (cp) { if (await copyText(cp.dataset.cp)) toast('تم النسخ'); return; }
    const ok = e.target.closest('[data-ok]');
    const no = e.target.closest('[data-no]');
    const d = rows.find((x) => x.id === (ok?.dataset.ok || no?.dataset.no));
    if (!d) return;
    if (ok) approve(d);
    if (no) {
      const reason = await confirmBox('رفض الإيداع', `${d.userName}: ${lyd(d.amount)} عبر ${d.provider}`, { ok: 'رفض', danger: true, input: { label: 'السبب (يظهر للزبون)', placeholder: 'مثلاً: ما وصلنا التحويل' } });
      if (reason === null) return;
      try { await api('/v1/admin/deposits/reject', { depositId: d.id, reason }); toast('تم الرفض وتبليغ الزبون'); } catch (err) { toastErr(err); }
    }
  });
  listen();
  return () => unsub && unsub();
}

function approve(d) {
  const s = sheet('قبول الإيداع', html`<form class="stack" id="f">
    <div class="list">
      <div class="list-row"><span class="grow muted">المستخدم</span><b>${d.userName}</b></div>
      <div class="list-row"><span class="grow muted">${d.provider}</span><b class="num">${d.phone || d.card_code}</b></div>
      ${d.currency === 'USD' ? html`<div class="list-row"><span class="grow muted">المحوّل</span><b class="num">$${d.amountOriginal} × ${d.rate}</b></div>` : ''}
    </div>
    <div class="field"><label for="am">المبلغ اللي يتضاف للمحفظة (د.ل)</label><input id="am" class="input ltr" dir="ltr" type="number" step="0.001" min="0.001" value="${d.amount}">
      <span class="hint">عدّله لو المبلغ اللي وصلك فعلاً مختلف عن اللي كتبه الزبون.</span></div>
    <button class="btn btn-success btn-block"><span class="label">قبول وشحن المحفظة</span><span class="spin"></span></button></form>`.html);
  s.el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    withLoading(e.target.querySelector('button'), async () => {
      try {
        const r = await api('/v1/admin/deposits/approve', { depositId: d.id, amount: Number(s.el.querySelector('#am').value) });
        toast(`تم شحن ${lyd(r.amount)} لمحفظة ${d.userName}`);
        s.close();
      } catch (err) { toastErr(err); }
    });
  };
}
