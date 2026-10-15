// الأقسام والمنتجات
import { db, collection, query, where, orderBy, getDocs, doc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, onSnapshot } from '../../../js/core/firebase.js';
import { html, raw, imgUrl, pricing } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { toast, toastErr, sheet, confirmBox, withLoading } from '../../../js/core/ui.js';
import { lyd, prodCell, emptyRow, formData, sw, audit } from '../kit.js';

export default async function page(el) {
  let cats = [];
  let current = sessionStorage.getItem('adm_cat') || null;
  let products = [];

  el.innerHTML = html`<section class="panel">
      <div class="panel-title"><h2>الأقسام</h2><button class="btn btn-primary btn-sm" id="addCat">${icon('plus', 'sm')}<span>قسم جديد</span></button></div>
      <div class="cat-tiles" id="cats"><div class="skel" style="height:64px"></div></div>
    </section>
    <section class="stack" id="prodSec" hidden>
      <div class="toolbar">
        <h2 id="catTitle" style="font-size:var(--fs-lg);flex:1"></h2>
        <button class="btn btn-ghost btn-sm" id="editCat">${icon('edit', 'sm')}<span>تعديل القسم</span></button>
        <button class="btn btn-primary btn-sm" id="addProd">${icon('plus', 'sm')}<span>منتج جديد</span></button>
      </div>
      <div class="toolbar" id="bulk" hidden><span class="hint" id="selCount"></span>
        <button class="btn btn-ghost btn-sm" id="bMove">نقل لقسم آخر</button><button class="btn btn-ghost btn-sm" id="bHide">إخفاء</button><button class="btn btn-ghost btn-sm" id="bShow">إظهار</button>
        <button class="btn btn-danger btn-sm" id="bDel">حذف</button></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th style="width:36px"><input type="checkbox" id="all" aria-label="تحديد الكل"></th><th>المنتج</th><th>السعر</th><th>الخصم</th><th>التسليم</th><th>المبيعات</th><th>ظاهر</th><th></th></tr></thead>
      <tbody id="tb"></tbody></table></div>
    </section>`.html;

  const unsub = onSnapshot(query(collection(db, 'categories'), orderBy('order')), (s) => {
    cats = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (current && !cats.find((c) => c.id === current)) current = null;
    drawCats();
    if (current) loadProducts();
  });

  function drawCats() {
    el.querySelector('#cats').innerHTML = cats.length ? cats.map((c) => html`<button class="cat-tile ${c.id === current ? 'active' : ''}" data-c="${c.id}">
      ${c.image || c.cover ? html`<img src="${imgUrl(c.image || c.cover)}" alt="" loading="lazy">` : html`<span class="cat-tile-ph" style="width:40px;height:40px;border-radius:10px;background:var(--ink-3)"></span>`}
      <span><b>${c.name}</b><small>${c.sectionType === 'smm' ? 'سوشيال' : 'ألعاب واشتراكات'}${c.active === false ? ' · مخفي' : ''}</small></span></button>`.html).join('') : '<p class="muted">أضف أول قسم.</p>';
    const sec = el.querySelector('#prodSec');
    sec.hidden = !current;
    if (current) el.querySelector('#catTitle').textContent = cats.find((c) => c.id === current)?.name || '';
  }

  async function loadProducts() {
    el.querySelector('#tb').innerHTML = emptyRow(8, 'جاري التحميل…');
    const s = await getDocs(query(collection(db, 'products'), where('categoryId', '==', current)));
    products = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => pricing(a).base - pricing(b).base);
    drawProducts();
  }

  function drawProducts() {
    el.querySelector('#all').checked = false;
    el.querySelector('#tb').innerHTML = products.length ? products.map((p) => {
      const pr = pricing(p);
      const del = { manual: 'يدوي', stock_code: 'أكواد تلقائية', shared_account: 'حساب مشترك' }[p.deliveryType || 'manual'];
      return html`<tr>
        <td><input type="checkbox" class="sel" value="${p.id}" aria-label="تحديد"></td>
        <td data-label="المنتج" class="full">${raw(prodCell(p.name, p.image || p.img, pr.qtyMode ? `كمية مرنة ${pr.qtyMin}–${pr.qtyMax}` : '').html)}</td>
        <td data-label="السعر" class="num strong">${lyd(pr.base)}</td>
        <td data-label="الخصم">${pr.discount ? html`<span class="badge red">${pr.discount}%</span>` : '—'}</td>
        <td data-label="التسليم"><span class="badge neutral">${del}</span></td>
        <td data-label="المبيعات" class="num">${Number(p.sales) || 0}</td>
        <td data-label="ظاهر"><span class="switch"><input type="checkbox" data-act="${p.id}" ${p.active !== false ? raw('checked') : ''} aria-label="ظاهر في المتجر"><span></span></span></td>
        <td class="acts-cell"><div class="acts"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">${icon('edit', 'sm')}<span>تعديل</span></button></div></td></tr>`.html;
    }).join('') : emptyRow(8, 'ما فيش منتجات في القسم هذا.');
    syncBulk();
  }

  const selected = () => [...el.querySelectorAll('.sel:checked')].map((x) => x.value);
  function syncBulk() {
    const n = selected().length;
    el.querySelector('#bulk').hidden = !n;
    el.querySelector('#selCount').textContent = `${n} محدد`;
  }

  el.querySelector('#cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    current = b.dataset.c;
    sessionStorage.setItem('adm_cat', current);
    drawCats();
    loadProducts();
  });
  el.querySelector('#addCat').onclick = () => catForm(null, cats);
  el.querySelector('#editCat').onclick = () => catForm(cats.find((c) => c.id === current), cats, () => { current = null; sessionStorage.removeItem('adm_cat'); });
  el.querySelector('#addProd').onclick = () => prodForm(null, cats, current, loadProducts);
  el.querySelector('#all').onchange = (e) => { el.querySelectorAll('.sel').forEach((x) => { x.checked = e.target.checked; }); syncBulk(); };
  el.querySelector('#tb').addEventListener('change', async (e) => {
    if (e.target.classList.contains('sel')) return syncBulk();
    const id = e.target.dataset.act;
    if (!id) return;
    try { await updateDoc(doc(db, 'products', id), { active: e.target.checked }); toast(e.target.checked ? 'المنتج ظاهر في المتجر' : 'تم إخفاء المنتج'); } catch (err) { e.target.checked = !e.target.checked; toastErr(err); }
  });
  el.querySelector('#tb').addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) prodForm(products.find((p) => p.id === b.dataset.edit), cats, current, loadProducts);
  });
  const bulk = async (fn, msg) => {
    const ids = selected();
    if (!ids.length) return;
    try { const batch = writeBatch(db); ids.forEach((id) => fn(batch, doc(db, 'products', id))); await batch.commit(); toast(msg(ids.length)); loadProducts(); } catch (err) { toastErr(err); }
  };
  el.querySelector('#bHide').onclick = () => bulk((b, r) => b.update(r, { active: false }), (n) => `تم إخفاء ${n} منتج`);
  el.querySelector('#bShow').onclick = () => bulk((b, r) => b.update(r, { active: true }), (n) => `تم إظهار ${n} منتج`);
  el.querySelector('#bDel').onclick = async () => {
    if (!(await confirmBox('حذف المنتجات', `حذف ${selected().length} منتج نهائياً؟ الطلبات القديمة ما تتأثرش.`, { ok: 'حذف', danger: true }))) return;
    const ids = selected();
    await bulk((b, r) => b.delete(r), (n) => `تم حذف ${n} منتج`);
    audit('products_deleted', { ids });
  };
  el.querySelector('#bMove').onclick = () => {
    const s = sheet('نقل المنتجات', html`<div class="stack"><div class="field"><label for="mv">القسم الجديد</label><select id="mv" class="select">${cats.filter((c) => c.id !== current).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div>
      <button class="btn btn-primary btn-block" id="go">نقل</button></div>`.html);
    s.el.querySelector('#go').onclick = async () => { const to = s.el.querySelector('#mv').value; s.close(); await bulk((b, r) => b.update(r, { categoryId: to }), (n) => `تم نقل ${n} منتج`); };
  };

  return unsub;
}

function catForm(c, cats, onDeleted) {
  const s = sheet(c ? 'تعديل القسم' : 'قسم جديد', html`<form class="form-grid" id="f">
    <div class="field"><label>اسم القسم</label><input name="name" class="input" required value="${c?.name || ''}"></div>
    <div class="field"><label>النوع</label><select name="sectionType" class="select">
      <option value="cards" ${c?.sectionType !== 'smm' ? raw('selected') : ''}>ألعاب واشتراكات</option><option value="smm" ${c?.sectionType === 'smm' ? raw('selected') : ''}>خدمات السوشيال</option></select></div>
    <div class="field"><label>الصورة (رابط أو اسم ملف)</label><input name="image" class="input ltr" dir="ltr" value="${c?.image || c?.cover || ''}" placeholder="https://… أو pubg.png"></div>
    <div class="field"><label>الترتيب</label><input name="order" type="number" class="input" value="${c?.order ?? cats.length + 1}"></div>
    ${raw(sw('active', c?.active !== false, 'ظاهر في المتجر').html)}
    <div class="row"><button class="btn btn-primary" style="flex:1"><span class="label">حفظ</span><span class="spin"></span></button>
    ${c ? html`<button type="button" class="btn btn-danger" id="del">${icon('trash', 'sm')}</button>` : ''}</div></form>`.html);
  const f = s.el.querySelector('#f');
  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading(f.querySelector('button.btn-primary'), async () => {
      const d = formData(f);
      const data = { name: d.name, sectionType: d.sectionType, image: d.image, cover: d.image, order: Number(d.order) || 1, active: d.active };
      try {
        if (c) await updateDoc(doc(db, 'categories', c.id), data);
        else await addDoc(collection(db, 'categories'), { ...data, createdAt: serverTimestamp() });
        toast('تم حفظ القسم');
        s.close();
      } catch (err) { toastErr(err); }
    });
  };
  if (c) {
    s.el.querySelector('#del').onclick = async () => {
      const n = (await getDocs(query(collection(db, 'products'), where('categoryId', '==', c.id)))).size;
      if (n) return toast(`القسم فيه ${n} منتج. انقلهم أو احذفهم أولاً`, 'err');
      if (!(await confirmBox('حذف القسم', `حذف "${c.name}" نهائياً؟`, { ok: 'حذف', danger: true }))) return;
      try { await deleteDoc(doc(db, 'categories', c.id)); audit('category_deleted', { id: c.id, name: c.name }); toast('تم حذف القسم'); s.close(); onDeleted && onDeleted(); } catch (err) { toastErr(err); }
    };
  }
}

function prodForm(p, cats, catId, done) {
  const ft = p?.fieldType || p?.type || 'id';
  const s = sheet(p ? 'تعديل المنتج' : 'منتج جديد', html`<form class="form-grid" id="f">
    <div class="field"><label>اسم المنتج</label><input name="name" class="input" required value="${p?.name || ''}" placeholder="مثلاً: 660 شدة ببجي"></div>
    <div class="split even">
      <div class="field"><label>السعر (د.ل)</label><input name="priceLYD" type="number" step="0.001" min="0" class="input ltr" dir="ltr" required value="${p?.priceLYD ?? p?.price ?? ''}"></div>
      <div class="field"><label>الخصم %</label><input name="discount" type="number" min="0" max="99" class="input ltr" dir="ltr" value="${p?.discount || 0}"></div>
    </div>
    <div class="field"><label>القسم</label><select name="categoryId" class="select">${cats.map((c) => html`<option value="${c.id}" ${(p?.categoryId || catId) === c.id ? raw('selected') : ''}>${c.name}</option>`)}</select></div>
    <div class="field"><label>الصورة (رابط أو اسم ملف)</label><input name="image" class="input ltr" dir="ltr" value="${p?.image || p?.img || ''}" placeholder="https://…"></div>
    <div class="field"><label>الوصف</label><textarea name="description" class="textarea">${p?.description || ''}</textarea></div>

    <div class="form-section"><h4>البيانات المطلوبة من الزبون</h4>
      ${raw(sw('fieldEnabled', p ? p.fieldEnabled !== false : true, 'الزبون يكتب بيانات (ID، رقم، رابط)').html)}
      <div class="split even">
        <div class="field"><label>نوع الحقل</label><select name="fieldType" class="select" id="ft">
          ${[['id', 'معرّف لاعب'], ['phone', 'رقم هاتف'], ['account', 'رابط حساب'], ['custom', 'نص مخصص']].map(([v, l]) => html`<option value="${v}" ${ft === v ? raw('selected') : ''}>${l}</option>`)}</select></div>
        <div class="field" id="customWrap" ${ft === 'custom' ? '' : raw('hidden')}><label>عنوان الحقل المخصص</label><input name="fieldCustomLabel" class="input" value="${p?.fieldCustomLabel || ''}" placeholder="مثلاً: يوزر انستقرام"></div>
      </div></div>

    <div class="form-section"><h4>التسليم</h4>
      <div class="split even">
        <div class="field"><label>طريقة التسليم</label><select name="deliveryType" class="select">
          ${[['manual', 'يدوي (الموظف ينفذ)'], ['stock_code', 'كود تلقائي من المخزون'], ['shared_account', 'حساب مشترك تلقائي']].map(([v, l]) => html`<option value="${v}" ${(p?.deliveryType || 'manual') === v ? raw('selected') : ''}>${l}</option>`)}</select></div>
        <div class="field"><label>تنبيه نقص المخزون عند</label><input name="lowStockThreshold" type="number" min="0" class="input ltr" dir="ltr" value="${p?.lowStockThreshold ?? 5}"></div>
      </div></div>

    <div class="form-section"><h4>الكمية المرنة (للرشق والخدمات بالعدد)</h4>
      ${raw(sw('enableQuantity', p?.enableQuantity === true, 'الزبون يختار الكمية').html)}
      <div class="split even">
        <div class="field"><label>أقل كمية (السعر فوق يكون لهذي الكمية)</label><input name="qtyMin" type="number" min="1" class="input ltr" dir="ltr" value="${p?.enableQuantity ? p.qtyMin : 100}"></div>
        <div class="field"><label>أكبر كمية</label><input name="qtyMax" type="number" min="1" class="input ltr" dir="ltr" value="${p?.enableQuantity ? p.qtyMax : 1000}"></div>
      </div></div>
    ${raw(sw('active', p ? p.active !== false : true, 'ظاهر في المتجر').html)}
    <div class="row sticky-save" style="background:var(--ink-2);padding:8px 0"><button class="btn btn-primary" style="flex:1"><span class="label">حفظ المنتج</span><span class="spin"></span></button>
      ${p ? html`<button type="button" class="btn btn-danger" id="del" aria-label="حذف">${icon('trash', 'sm')}</button>` : ''}</div>
  </form>`.html, { wide: true });
  const f = s.el.querySelector('#f');
  f.querySelector('#ft').onchange = (e) => { f.querySelector('#customWrap').hidden = e.target.value !== 'custom'; };
  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading(f.querySelector('button.btn-primary'), async () => {
      const d = formData(f);
      if (!(d.priceLYD >= 0)) return toast('أدخل السعر', 'err');
      const qMode = d.enableQuantity;
      const data = {
        name: d.name, priceLYD: d.priceLYD, price: d.priceLYD, discount: Math.min(Math.max(d.discount || 0, 0), 99),
        categoryId: d.categoryId, image: d.image, img: d.image, description: d.description,
        fieldEnabled: d.fieldEnabled, fieldType: d.fieldType, type: d.fieldType, fieldCustomLabel: d.fieldCustomLabel,
        deliveryType: d.deliveryType, lowStockThreshold: d.lowStockThreshold ?? 5,
        enableQuantity: qMode, qtyMin: qMode ? Math.max(1, d.qtyMin || 1) : 1, qtyMax: qMode ? Math.max(d.qtyMin || 1, d.qtyMax || 1) : 1,
        active: d.active, updatedAt: serverTimestamp(),
      };
      try {
        if (p) await updateDoc(doc(db, 'products', p.id), data);
        else await addDoc(collection(db, 'products'), { ...data, sales: 0, order: Date.now(), createdAt: serverTimestamp() });
        if (p && Number(p.priceLYD ?? p.price) !== data.priceLYD) audit('price_changed', { productId: p.id, name: data.name, from: Number(p.priceLYD ?? p.price), to: data.priceLYD });
        toast('تم حفظ المنتج');
        s.close();
        done();
      } catch (err) { toastErr(err); }
    });
  };
  if (p) {
    s.el.querySelector('#del').onclick = async () => {
      if (!(await confirmBox('حذف المنتج', `حذف "${p.name}" نهائياً؟`, { ok: 'حذف', danger: true }))) return;
      try { await deleteDoc(doc(db, 'products', p.id)); audit('product_deleted', { productId: p.id, name: p.name }); toast('تم الحذف'); s.close(); done(); } catch (err) { toastErr(err); }
    };
  }
}
