// المخزون: أكواد البطاقات والحسابات المشتركة
import { db, collection, query, where, getDocs, doc, deleteDoc, writeBatch, updateDoc, serverTimestamp } from '../../../js/core/firebase.js';
import { html, raw, fmtDate } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { toast, toastErr, confirmBox, withLoading } from '../../../js/core/ui.js';
import { prodCell, tsMs, audit } from '../kit.js';

export default async function page(el) {
  el.innerHTML = '<div class="skel" style="height:200px"></div>';
  const snap = await getDocs(query(collection(db, 'products'), where('deliveryType', 'in', ['stock_code', 'shared_account'])));
  const prods = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
  if (!prods.length) {
    el.innerHTML = html`<div class="panel"><div class="empty">${icon('box')}<h3>ما فيش منتجات بتسليم تلقائي</h3>
      <p>من "الأقسام والمنتجات" افتح منتج وخلي طريقة التسليم "كود تلقائي" أو "حساب مشترك".</p><a class="btn btn-primary" href="#/catalog">الأقسام والمنتجات</a></div></div>`.html;
    return;
  }
  let pick = sessionStorage.getItem('adm_stock') || prods[0].id;
  if (!prods.find((p) => p.id === pick)) pick = prods[0].id;

  el.innerHTML = html`<div class="split">
    <section class="stack" id="main"></section>
    <aside class="panel"><div class="panel-title"><h2>المنتجات</h2></div><div class="list" id="plist">${prods.map((p) => html`<button class="list-row" style="text-align:start;width:100%" data-p="${p.id}">
      <span class="grow">${raw(prodCell(p.name, p.image || p.img, p.deliveryType === 'stock_code' ? 'أكواد' : 'حساب مشترك').html)}</span><span class="hint" data-cnt="${p.id}"></span></button>`)}</div></aside>
  </div>`.html;

  const main = el.querySelector('#main');
  const mark = () => el.querySelectorAll('[data-p]').forEach((b) => { b.style.background = b.dataset.p === pick ? 'var(--crimson-wash)' : ''; });
  el.querySelector('#plist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    pick = b.dataset.p;
    sessionStorage.setItem('adm_stock', pick);
    mark();
    draw();
  });

  async function draw() {
    const p = prods.find((x) => x.id === pick);
    main.innerHTML = '<div class="skel" style="height:240px"></div>';
    if (p.deliveryType === 'stock_code') await drawCodes(p); else await drawAccounts(p);
  }

  async function drawCodes(p) {
    const s = await getDocs(query(collection(db, 'stock_codes'), where('productId', '==', p.id)));
    const all = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const avail = all.filter((c) => (c.status || 'available') === 'available');
    const sold = all.filter((c) => c.status === 'sold').sort((a, b) => tsMs(b.soldAt) - tsMs(a.soldAt));
    const cnt = el.querySelector(`[data-cnt="${p.id}"]`);
    if (cnt) cnt.textContent = `${avail.length} متاح`;
    main.innerHTML = html`
      <div class="kpis" style="grid-template-columns:repeat(2,1fr)">
        <div class="kpi ${avail.length <= (Number(p.lowStockThreshold) || 5) ? 'alert' : ''}"><div class="k-label"><span>متاح</span>${icon('box')}</div><div class="k-val num">${avail.length}</div></div>
        <div class="kpi"><div class="k-label"><span>مباع</span>${icon('check')}</div><div class="k-val num">${sold.length}</div></div>
      </div>
      <section class="panel stack"><div class="panel-title"><h2>${p.name}: إضافة أكواد</h2></div>
        <textarea id="codes" class="textarea ltr" dir="ltr" rows="6" placeholder="كود واحد في كل سطر"></textarea>
        <button class="btn btn-primary" id="add"><span class="label">إضافة للمخزون</span><span class="spin"></span></button>
        <p class="hint">الأكواد المكررة (موجودة قبل) تتجاهل تلقائياً. الأكواد سرية وما يشوفهاش إلا اللي عنده صلاحية المخزون.</p></section>
      <section class="panel"><div class="panel-title"><h2>المتاح</h2></div>
        <div class="list">${avail.slice(0, 200).map((c) => html`<div class="list-row"><code class="grow ltr" style="text-align:left;overflow-wrap:anywhere">${c.code}</code><button class="icon-btn" data-del="${c.id}" aria-label="حذف الكود">${icon('trash', 'sm')}</button></div>`)}</div>
        ${!avail.length ? html`<p class="muted">المخزون فاضي. الطلبات الجديدة تتسجل معلقة لين تضيف أكواد.</p>` : ''}</section>
      ${sold.length ? html`<section class="panel"><div class="panel-title"><h2>آخر المباع</h2></div><div class="list">${sold.slice(0, 30).map((c) => html`<div class="list-row"><code class="grow ltr hint" style="text-align:left">${c.code}</code><span class="hint">${fmtDate(c.soldAt)}</span></div>`)}</div></section>` : ''}`.html;

    main.querySelector('#add').onclick = (e) => withLoading(e.currentTarget, async () => {
      const existing = new Set(all.map((c) => c.code));
      const fresh = [...new Set(main.querySelector('#codes').value.split('\n').map((x) => x.trim()).filter(Boolean))].filter((c) => !existing.has(c));
      if (!fresh.length) return toast('ما فيش أكواد جديدة', 'err');
      try {
        for (let i = 0; i < fresh.length; i += 400) {
          const b = writeBatch(db);
          fresh.slice(i, i + 400).forEach((code) => b.set(doc(collection(db, 'stock_codes')), { productId: p.id, code, status: 'available', createdAt: serverTimestamp() }));
          await b.commit();
        }
        audit('stock_added', { productId: p.id, name: p.name, count: fresh.length });
        toast(`تمت إضافة ${fresh.length} كود`);
        draw();
      } catch (err) { toastErr(err); }
    });
    main.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmBox('حذف الكود', 'يتحذف من المخزون نهائياً.', { ok: 'حذف', danger: true }))) return;
        try { await deleteDoc(doc(db, 'stock_codes', b.dataset.del)); audit('stock_deleted', { productId: p.id }); draw(); } catch (err) { toastErr(err); }
      };
    });
  }

  async function drawAccounts(p) {
    const s = await getDocs(query(collection(db, 'shared_accounts'), where('productId', '==', p.id)));
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const free = list.reduce((n, a) => n + Math.max((Number(a.capacity) || 1) - (Number(a.usedSlots) || 0), 0), 0);
    const cnt = el.querySelector(`[data-cnt="${p.id}"]`);
    if (cnt) cnt.textContent = `${free} خانة`;
    main.innerHTML = html`
      <section class="panel stack"><div class="panel-title"><h2>${p.name}: حساب جديد</h2><span class="badge ${free ? 'ok' : 'bad'}">${free} خانة فاضية</span></div>
        <div class="field"><label for="ad">بيانات الدخول (تظهر للزبون كما هي)</label><textarea id="ad" class="textarea ltr" dir="ltr" rows="3" placeholder="email@example.com&#10;password: ****&#10;Profile: 3"></textarea></div>
        <div class="field"><label for="cap">عدد المستخدمين على الحساب</label><input id="cap" class="input ltr" dir="ltr" type="number" min="1" value="5"></div>
        <button class="btn btn-primary" id="add"><span class="label">إضافة الحساب</span><span class="spin"></span></button></section>
      <section class="panel"><div class="panel-title"><h2>الحسابات</h2></div><div class="stack">
        ${list.map((a) => {
          const cap = Number(a.capacity) || 1; const used = Number(a.usedSlots) || 0;
          return html`<div class="panel" style="padding:14px;background:var(--ink)"><div class="row between"><span class="badge ${used >= cap ? 'bad' : 'ok'}">${used}/${cap}</span>
            <div class="row"><button class="btn btn-ghost btn-sm" data-reset="${a.id}">تصفير</button><button class="icon-btn" data-delacc="${a.id}" aria-label="حذف">${icon('trash', 'sm')}</button></div></div>
            <div class="meter-bar ${used >= cap ? 'full' : ''}" style="margin:10px 0"><span style="width:${Math.min(100, (used / cap) * 100)}%"></span></div>
            <pre class="ltr" style="text-align:left;white-space:pre-wrap;font-size:var(--fs-sm)">${a.accountData}</pre></div>`;
        })}
        ${!list.length ? html`<p class="muted">ما فيش حسابات.</p>` : ''}</div></section>`.html;
    main.querySelector('#add').onclick = (e) => withLoading(e.currentTarget, async () => {
      const accountData = main.querySelector('#ad').value.trim();
      const capacity = Math.max(1, Number(main.querySelector('#cap').value) || 1);
      if (!accountData) return toast('أدخل بيانات الحساب', 'err');
      try {
        const b = writeBatch(db);
        b.set(doc(collection(db, 'shared_accounts')), { productId: p.id, accountData, capacity, usedSlots: 0, status: 'active', createdAt: serverTimestamp() });
        await b.commit();
        audit('shared_account_added', { productId: p.id, capacity });
        toast('تمت إضافة الحساب');
        draw();
      } catch (err) { toastErr(err); }
    });
    main.querySelectorAll('[data-delacc]').forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmBox('حذف الحساب', 'الزبائن اللي استلموه ما يتأثروش.', { ok: 'حذف', danger: true }))) return;
        try { await deleteDoc(doc(db, 'shared_accounts', b.dataset.delacc)); draw(); } catch (err) { toastErr(err); }
      };
    });
    main.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmBox('تصفير الخانات', 'استعمله لما تجدد الحساب لدورة جديدة.', { ok: 'تصفير' }))) return;
        try { await updateDoc(doc(db, 'shared_accounts', b.dataset.reset), { usedSlots: 0, status: 'active' }); audit('shared_account_reset', { id: b.dataset.reset }); draw(); } catch (err) { toastErr(err); }
      };
    });
  }

  mark();
  draw();
  // عداد المتاح لكل منتج في القائمة
  prods.forEach(async (p) => {
    if (p.deliveryType !== 'stock_code' || p.id === pick) return;
    const s = await getDocs(query(collection(db, 'stock_codes'), where('productId', '==', p.id), where('status', '==', 'available'))).catch(() => null);
    const c = el.querySelector(`[data-cnt="${p.id}"]`);
    if (s && c) c.textContent = `${s.size} متاح`;
  });
}
