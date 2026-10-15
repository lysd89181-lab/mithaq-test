// صفحة المنتج: الفئات، البيانات المطلوبة، الكمية، الإضافة للسلة
import { html, raw, imgUrl, pricing, money3 } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { fmt, subscribe } from '../core/state.js';
import { product, productsOf, category } from '../services/catalog.js';
import { addToCart } from '../services/cart.js';
import { toast } from '../core/ui.js';
import { empty, priceHtml } from '../components/blocks.js';
import { go } from '../core/router.js';

const FIELD = {
  id: { label: 'معرّف اللاعب (ID)', ph: 'مثال: 5123456789', ltr: true },
  phone: { label: 'رقم الهاتف المطلوب شحنه', ph: '09XXXXXXXX', ltr: true },
  account: { label: 'رابط الحساب أو اسم المستخدم', ph: 'https://… أو @user', ltr: true },
};

export default async function page(el, { match: [id] }) {
  el.innerHTML = '<div class="page"><div class="pd"><div class="skel pd-art"></div><div class="stack"><div class="skel" style="height:40px"></div><div class="skel" style="height:140px"></div></div></div></div>';
  const p = await product(id);
  if (!p || p.active === false) {
    el.innerHTML = `<div class="page">${empty('box', 'المنتج غير متوفر', 'ممكن انحذف أو انتهى.', '<a class="btn btn-ghost" href="#/categories">تصفح الأقسام</a>')}</div>`;
    return;
  }
  const [siblings, cat] = await Promise.all([p.categoryId ? productsOf(p.categoryId) : [], p.categoryId ? category(p.categoryId) : null]);
  const pr = pricing(p);
  const ft = p.fieldType || p.type || 'id';
  const field = ft === 'custom' ? { label: p.fieldCustomLabel || 'البيانات المطلوبة', ph: '', ltr: false } : FIELD[ft] || FIELD.id;
  const needsData = p.fieldEnabled !== false;
  let qty = pr.qtyMin;

  const draw = () => {
    const total = money3(pr.unit * qty);
    el.innerHTML = html`<div class="page">
      <div class="page-head"><a href="#${cat ? `/c/${cat.id}` : '/categories'}" class="back" aria-label="رجوع">${icon('back')}</a>
        <span class="muted" style="font-size:var(--fs-sm)">${cat ? cat.name : ''}</span></div>
      <div class="pd">
        <div class="pd-art">${imgUrl(p.image || p.img) ? html`<img src="${imgUrl(p.image || p.img)}" alt="">` : html`<span class="fallback" style="font-size:3rem;color:var(--fog-2)">${(p.name || '').slice(0, 2)}</span>`}</div>
        <div class="stack-lg">
          <div class="stack" style="gap:8px">
            <h1>${p.name}</h1>
            <div class="row" style="align-items:baseline">
              <div class="price">${raw(priceHtml(pr.final))}</div>
              ${pr.discount > 0 ? html`<span class="price-old">${fmt(pr.base)}</span><span class="badge red">خصم ${pr.discount}%</span>` : ''}
              ${pr.qtyMode ? html`<span class="muted" style="font-size:var(--fs-sm)">لكل ${pr.qtyMin}</span>` : ''}
            </div>
            ${p.description ? html`<p class="muted" style="white-space:pre-line">${p.description}</p>` : ''}
          </div>

          ${siblings.length > 1 ? html`<div class="stack" style="gap:8px"><span class="label-text">اختر الفئة</span>
            <div class="chips">${siblings.map((s) => html`<a href="#/p/${s.id}" class="chip ${s.id === p.id ? 'active' : ''}" ${s.id === p.id ? raw('aria-current="true"') : ''}>${s.name}</a>`)}</div></div>` : ''}

          ${needsData ? html`<div class="field"><label for="pdData">${field.label}</label>
            <input id="pdData" class="input ${field.ltr ? 'ltr' : ''}" ${field.ltr ? raw('dir="ltr"') : ''} placeholder="${field.ph}" autocomplete="off" maxlength="300">
            <span class="hint">تأكد من البيانات، الطلب بعد التنفيذ ما يتسترجعش.</span></div>` : ''}

          <div class="row between">
            <span class="label-text">${pr.qtyMode ? `الكمية (${pr.qtyMin} – ${pr.qtyMax})` : 'العدد'}</span>
            <div class="stepper"><button data-q="-" aria-label="إنقاص">${icon('minus', 'sm')}</button>
              <input id="pdQty" type="number" inputmode="numeric" value="${qty}" min="${pr.qtyMin}" max="${pr.qtyMax}" aria-label="الكمية">
              <button data-q="+" aria-label="زيادة">${icon('plus', 'sm')}</button></div>
          </div>
          ${pr.qtyMode ? html`<input type="range" id="pdRange" min="${pr.qtyMin}" max="${pr.qtyMax}" value="${qty}" style="width:100%;accent-color:var(--crimson)" aria-label="الكمية">` : ''}

          <div class="row between panel" style="padding:14px 16px"><span class="muted">الإجمالي</span><b class="price" id="pdTotal">${raw(priceHtml(total))}</b></div>

          <div class="buy-bar">
            <button class="btn btn-ghost" id="pdAdd">${icon('cart')}<span>أضف للسلة</span></button>
            <button class="btn btn-primary" id="pdBuy">${icon('zap')}<span>اشتري الآن</span></button>
          </div>

          <div class="assure"><div>${icon('zap')}<span>${p.deliveryType && p.deliveryType !== 'manual' ? 'تسليم تلقائي' : 'تنفيذ سريع'}</span></div>
            <div>${icon('shield')}<span>دفع من محفظتك</span></div><div>${icon('headset')}<span>دعم 24/7</span></div></div>
        </div>
      </div>
    </div>`.html;
    bind();
  };

  const setQty = (v) => {
    qty = Math.min(Math.max(Math.floor(Number(v) || pr.qtyMin), pr.qtyMin), pr.qtyMax);
    el.querySelector('#pdQty').value = qty;
    const r = el.querySelector('#pdRange');
    if (r) r.value = qty;
    el.querySelector('#pdTotal').innerHTML = priceHtml(money3(pr.unit * qty));
  };

  const take = () => {
    let data = '';
    if (needsData) {
      const inp = el.querySelector('#pdData');
      data = inp.value.trim();
      if (!data) { inp.focus(); toast(`أدخل ${field.label}`, 'err'); return null; }
    }
    addToCart(p, qty, data);
    return true;
  };

  function bind() {
    el.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => setQty(qty + (b.dataset.q === '+' ? (pr.qtyMode ? Math.max(1, Math.round(pr.qtyMin / 2)) : 1) : -(pr.qtyMode ? Math.max(1, Math.round(pr.qtyMin / 2)) : 1))); });
    el.querySelector('#pdQty').onchange = (e) => setQty(e.target.value);
    const r = el.querySelector('#pdRange');
    if (r) r.oninput = (e) => setQty(e.target.value);
    el.querySelector('#pdAdd').onclick = () => { if (take()) { toast('تمت الإضافة للسلة'); } };
    el.querySelector('#pdBuy').onclick = () => { if (take()) go('/cart'); };
  }

  draw();
  return subscribe((s, patch) => { if ('currency' in patch) { const d = el.querySelector('#pdData')?.value; draw(); setQty(qty); if (d) el.querySelector('#pdData').value = d; } });
}
