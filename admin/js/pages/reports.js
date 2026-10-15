// التقارير
import { db, collection, query, where, limit, getDocs, Timestamp } from '../../../js/core/firebase.js';
import { html, raw } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { lyd, tsMs, downloadCsv } from '../kit.js';
import { salesChart } from './dashboard.js';

const RANGES = [['7', '7 أيام'], ['30', '30 يوم'], ['90', '3 شهور'], ['365', 'سنة']];

export default async function page(el) {
  let range = '30';
  el.innerHTML = html`<section class="stack">
    <div class="toolbar"><div class="segmented">${RANGES.map(([v, l]) => html`<button data-r="${v}" class="${v === range ? 'active' : ''}">${l}</button>`)}</div>
      <button class="btn btn-ghost btn-sm" id="csv">${icon('download', 'sm')}<span>تصدير المبيعات</span></button></div>
    <div id="body"><div class="skel" style="height:300px"></div></div></section>`.html;
  let orders = [];
  let deposits = [];

  async function load() {
    el.querySelector('#body').innerHTML = '<div class="skel" style="height:300px"></div>';
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - Number(range) + 1);
    const t = Timestamp.fromDate(from);
    const [o, d] = await Promise.all([
      getDocs(query(collection(db, 'orders'), where('createdAt', '>=', t), limit(10000))),
      getDocs(query(collection(db, 'deposits'), where('createdAt', '>=', t), limit(10000))).catch(() => null),
    ]);
    orders = o.docs.map((x) => x.data());
    deposits = d ? d.docs.map((x) => x.data()) : [];
    draw(from);
  }

  function draw(from) {
    const done = orders.filter((o) => o.status === 'completed');
    const val = (o) => Number(o.amount ?? o.price) || 0;
    const revenue = done.reduce((s, o) => s + val(o), 0);
    const refunds = orders.filter((o) => o.status === 'canceled').reduce((s, o) => s + (Number(o.refundAmount) || val(o)), 0);
    const discounts = orders.reduce((s, o) => s + (Number(o.discount) || 0), 0);
    const buyers = new Set(done.map((o) => o.userId)).size;
    const depOk = deposits.filter((x) => x.status === 'approved');

    // تجميع يومي أو أسبوعي حسب المدة
    const days = Number(range);
    const bucket = days > 60 ? 7 : 1;
    const series = [];
    for (let i = 0; i < Math.ceil(days / bucket); i++) {
      const s = new Date(from); s.setDate(s.getDate() + i * bucket);
      const e = new Date(s); e.setDate(e.getDate() + bucket);
      series.push({ label: s.toLocaleDateString('ar-LY', { day: 'numeric', month: 'short' }), short: bucket > 1 || days <= 31 ? s.getDate() : '', v: done.filter((o) => tsMs(o.createdAt) >= s.getTime() && tsMs(o.createdAt) < e.getTime()).reduce((n, o) => n + val(o), 0) });
    }
    if (series.length > 31) series.forEach((p, i) => { if (i % 3) p.short = ''; });

    const byProduct = {};
    done.forEach((o) => { const k = o.serviceName || o.cardName || '—'; byProduct[k] = byProduct[k] || { n: 0, v: 0 }; byProduct[k].n += Number(o.quantity) || 1; byProduct[k].v += val(o); });
    const top = Object.entries(byProduct).sort((a, b) => b[1].v - a[1].v).slice(0, 10);
    const topMax = top[0]?.[1].v || 1;
    const byMethod = {};
    depOk.forEach((x) => { const k = x.provider || 'أخرى'; byMethod[k] = (byMethod[k] || 0) + (Number(x.approvedAmount ?? x.amount) || 0); });
    const methods = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);
    const mMax = methods[0]?.[1] || 1;

    el.querySelector('#body').innerHTML = html`<div class="stack-lg">
      <div class="kpis">
        <div class="kpi"><div class="k-label"><span>صافي المبيعات</span>${icon('coin')}</div><div class="k-val num">${lyd(revenue)}</div><div class="k-sub">${done.length} طلب مكتمل</div></div>
        <div class="kpi"><div class="k-label"><span>متوسط الطلب</span>${icon('receipt')}</div><div class="k-val num">${lyd(done.length ? revenue / done.length : 0)}</div><div class="k-sub">${buyers} زبون اشترى</div></div>
        <div class="kpi"><div class="k-label"><span>المسترجع</span>${icon('refresh')}</div><div class="k-val num">${lyd(refunds)}</div><div class="k-sub">خصومات الكوبونات ${lyd(discounts)}</div></div>
        <div class="kpi"><div class="k-label"><span>الشحن المقبول</span>${icon('wallet')}</div><div class="k-val num">${lyd(depOk.reduce((s, x) => s + (Number(x.approvedAmount ?? x.amount) || 0), 0))}</div><div class="k-sub">${depOk.length} عملية</div></div>
      </div>
      <section class="panel"><div class="panel-title"><h2>المبيعات ${bucket > 1 ? 'الأسبوعية' : 'اليومية'}</h2></div>${raw(salesChart(series))}</section>
      <div class="split even">
        <section class="panel"><div class="panel-title"><h2>أكثر المنتجات مبيعاً</h2></div>
          <div class="bars">${top.length ? top.map(([n, x]) => html`<div class="bar-row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</span><div class="track"><div class="fill" style="width:${(x.v / topMax) * 100}%"></div></div><span class="num hint">${lyd(x.v)} · ${x.n}</span></div>`) : html`<p class="muted">ما فيش مبيعات في المدة هذي.</p>`}</div></section>
        <section class="panel"><div class="panel-title"><h2>الشحن حسب طريقة الدفع</h2></div>
          <div class="bars">${methods.length ? methods.map(([n, v]) => html`<div class="bar-row"><span>${n}</span><div class="track"><div class="fill" style="width:${(v / mMax) * 100}%;background:var(--ok)"></div></div><span class="num hint">${lyd(v)}</span></div>`) : html`<p class="muted">ما فيش شحنات مقبولة.</p>`}</div></section>
      </div></div>`.html;
  }

  el.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => { range = b.dataset.r; el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('active', x === b)); load(); }; });
  el.querySelector('#csv').onclick = () => downloadCsv(`sales-${range}d.csv`, [['الفاتورة', 'المنتج', 'الكمية', 'المبلغ', 'الخصم', 'الحالة', 'التاريخ'],
    ...orders.map((o) => [o.invoiceNumber, o.serviceName, o.quantity, o.amount ?? o.price, o.discount || 0, o.status, new Date(tsMs(o.createdAt)).toLocaleString('en-GB')])]);
  await load();
}
