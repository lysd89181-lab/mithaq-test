// الرئيسية: نظرة عامة
import { db, collection, query, where, orderBy, limit, getDocs, getCountFromServer, Timestamp } from '../../../js/core/firebase.js';
import { html, raw, fmtDate } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { can } from '../session.js';
import { lyd, badge, tsMs, prodCell } from '../kit.js';

const dayStart = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function salesChart(days) {
  const W = 640, H = 220, P = { l: 44, r: 12, t: 14, b: 26 };
  const max = Math.max(...days.map((d) => d.v), 1);
  const step = (W - P.l - P.r) / Math.max(days.length - 1, 1);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const pts = days.map((d, i) => [P.l + i * step, y(d.v)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0]},${H - P.b} L${P.l},${H - P.b} Z`;
  const ticks = [0, 0.5, 1].map((f) => ({ v: max * f, y: y(max * f) }));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="المبيعات اليومية">
    <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E3123F" stop-opacity=".35"/><stop offset="1" stop-color="#E3123F" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${t.y}" y2="${t.y}"/><text x="${P.l - 6}" y="${t.y + 3}" text-anchor="end">${Math.round(t.v)}</text>`).join('')}</g>
    <path class="area" d="${area}"/><path class="line" d="${line}"/>
    ${pts.map((p, i) => `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="3.5"><title>${days[i].label}: ${days[i].v.toFixed(3)} د.ل</title></circle>
      <text x="${p[0]}" y="${H - 8}" text-anchor="middle">${days[i].short}</text>`).join('')}
  </svg>`;
}

export default async function page(el) {
  el.innerHTML = html`
    <div class="kpis" id="kpis">${Array.from({ length: 4 }, () => raw('<div class="kpi skel" style="height:104px"></div>'))}</div>
    <div class="split">
      ${can('reports') || can('orders') ? html`<section class="panel"><div class="panel-title"><h2>المبيعات آخر 14 يوم</h2></div><div id="chart"><div class="skel" style="height:220px"></div></div></section>` : ''}
      <section class="panel"><div class="panel-title"><h2>تنبيهات مهمة</h2></div><div id="alerts" class="stack"><div class="skel" style="height:80px"></div></div></section>
    </div>
    ${can('orders') ? html`<section class="panel"><div class="panel-title"><h2>أحدث الطلبات</h2><a href="#/orders" class="btn btn-ghost btn-sm">كل الطلبات</a></div><div id="latest"><div class="skel" style="height:200px"></div></div></section>` : ''}`.html;

  const kp = [];
  const today = dayStart();
  const since = new Date(today); since.setDate(since.getDate() - 13);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  let recent = [];
  if (can('orders') || can('reports')) {
    const from = since < monthStart ? since : monthStart;
    const snap = await getDocs(query(collection(db, 'orders'), where('createdAt', '>=', Timestamp.fromDate(from)), limit(5000))).catch(() => null);
    recent = snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    const done = recent.filter((o) => o.status === 'completed');
    const sum = (arr) => arr.reduce((s, o) => s + (Number(o.amount ?? o.price) || 0), 0);
    const todaySales = sum(done.filter((o) => tsMs(o.createdAt) >= today.getTime()));
    const monthSales = sum(done.filter((o) => tsMs(o.createdAt) >= monthStart.getTime()));
    kp.push({ label: 'مبيعات اليوم', icon: 'coin', val: lyd(todaySales), sub: `${done.filter((o) => tsMs(o.createdAt) >= today.getTime()).length} طلب مكتمل` });
    kp.push({ label: 'مبيعات الشهر', icon: 'chart', val: lyd(monthSales), sub: today.toLocaleDateString('ar-LY', { month: 'long', year: 'numeric' }) });
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(since); d.setDate(d.getDate() + i);
      const s = d.getTime(); const e = s + 86400000;
      return { label: d.toLocaleDateString('ar-LY', { weekday: 'long', day: 'numeric' }), short: d.getDate(), v: sum(done.filter((o) => tsMs(o.createdAt) >= s && tsMs(o.createdAt) < e)) };
    });
    const ch = el.querySelector('#chart');
    if (ch) ch.innerHTML = salesChart(days);
  }
  const count = async (q) => (await getCountFromServer(q).catch(() => null))?.data().count ?? '—';
  if (can('orders')) {
    const n = await count(query(collection(db, 'orders'), where('status', '==', 'pending')));
    kp.push({ label: 'طلبات معلقة', icon: 'clock', val: n, sub: 'تحتاج تنفيذ', alert: n > 0, href: '#/orders' });
  }
  if (can('deposits')) {
    const n = await count(query(collection(db, 'deposits'), where('status', '==', 'pending')));
    kp.push({ label: 'إيداعات معلقة', icon: 'wallet', val: n, sub: 'تحتاج مراجعة', alert: n > 0, href: '#/deposits' });
  }
  if (can('users')) {
    const n = await count(collection(db, 'users'));
    const fresh = await count(query(collection(db, 'users'), where('createdAt', '>=', Timestamp.fromDate(today))));
    kp.push({ label: 'المستخدمين', icon: 'users', val: n, sub: `+${fresh} اليوم` });
  }
  el.querySelector('#kpis').innerHTML = kp.slice(0, 8).map((k) => html`<${raw(k.href ? 'a' : 'div')} class="kpi ${k.alert ? 'alert' : ''}" ${k.href ? raw(`href="${k.href}"`) : ''}>
    <div class="k-label"><span>${k.label}</span>${icon(k.icon)}</div><div class="k-val num">${k.val}</div><div class="k-sub">${k.sub}</div></${raw(k.href ? 'a' : 'div')}>`.html).join('');

  // التنبيهات: نقص المخزون + طلبات متأخرة
  const alerts = [];
  if (can('orders')) {
    const late = recent.filter((o) => o.status === 'pending' && Date.now() - tsMs(o.createdAt) > 3600000);
    if (late.length) alerts.push({ icon: 'clock', cls: 'bad', text: `${late.length} طلب معلق أكثر من ساعة`, href: '#/orders' });
  }
  if (can('stock')) {
    const ps = await getDocs(query(collection(db, 'products'), where('deliveryType', '==', 'stock_code'))).catch(() => null);
    for (const p of ps ? ps.docs.slice(0, 30) : []) {
      const d = p.data();
      if (d.active === false) continue;
      const n = await count(query(collection(db, 'stock_codes'), where('productId', '==', p.id), where('status', '==', 'available')));
      if (typeof n === 'number' && n <= (Number(d.lowStockThreshold) || 5)) alerts.push({ icon: 'box', cls: n ? 'wait' : 'bad', text: `${d.name}: ${n ? `باقي ${n} كود` : 'نفد المخزون'}`, href: '#/stock' });
    }
  }
  el.querySelector('#alerts').innerHTML = alerts.length
    ? alerts.map((a) => html`<a class="banner info" href="${a.href}" style="justify-content:flex-start"><span class="badge ${a.cls}">${icon(a.icon, 'sm')}</span><span>${a.text}</span></a>`.html).join('')
    : '<p class="muted">كل شي تمام. ما فيش تنبيهات.</p>';

  if (can('orders')) {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(8)));
    const box = el.querySelector('#latest');
    box.innerHTML = html`<table class="tbl"><thead><tr><th>المستخدم</th><th>المنتج</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>
      ${snap.docs.map((d) => { const o = d.data(); return html`<tr><td data-label="المستخدم" class="strong">${o.userName || '—'}</td><td data-label="المنتج">${raw(prodCell(o.serviceName || o.cardName || '—', '').html)}</td>
        <td data-label="المبلغ" class="num">${lyd(o.amount ?? o.price)}</td><td data-label="الحالة">${badge(o.status)}</td><td data-label="التاريخ" class="hint">${fmtDate(o.createdAt)}</td></tr>`; })}
    </tbody></table>`.html;
  }
}
