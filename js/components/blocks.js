// قطع واجهة مشتركة بين الصفحات
import { html, raw, esc, imgUrl, pricing } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { fmt, state } from '../core/state.js';

export function productCard(p) {
  const pr = pricing(p);
  const img = imgUrl(p.image || p.img);
  return html`<article class="ticket">
    ${pr.discount > 0 ? html`<span class="badge red off">-${pr.discount}%</span>` : ''}
    <a href="#/p/${p.id}" class="ticket-art" aria-label="${p.name}">
      ${img ? html`<img src="${img}" alt="" loading="lazy" onerror="this.remove()">` : html`<span class="fallback">${(p.name || '؟').slice(0, 2)}</span>`}
    </a>
    <div class="ticket-perf" aria-hidden="true"></div>
    <div class="ticket-body">
      <a href="#/p/${p.id}" class="ticket-name">${p.name || 'منتج'}</a>
      <div class="ticket-foot">
        <div>
          ${pr.discount > 0 ? html`<div class="price-old">${fmt(pr.base)}</div>` : ''}
          <div class="price">${raw(priceHtml(pr.qtyMode ? pr.final : pr.final))}</div>
          ${pr.qtyMode ? html`<div class="hint">لكل ${pr.qtyMin}</div>` : ''}
        </div>
        <button class="ticket-add" data-add="${p.id}" aria-label="إضافة ${p.name} للسلة">${icon('plus')}</button>
      </div>
    </div>
  </article>`;
}

// السعر مع الوحدة بخط أصغر
export function priceHtml(lyd) {
  const v = fmt(lyd, { unit: false });
  return state.currency === 'USD' ? `<span class="num">$${esc(v)}</span>` : `<span class="num">${esc(v)}</span><small>د.ل</small>`;
}

export function skeletonGrid(n = 4, cls = 'products') {
  return `<div class="${cls}">${Array.from({ length: n }, () => '<div class="skel" style="aspect-ratio:3/4"></div>').join('')}</div>`;
}

export function empty(iconName, title, text = '', action = '') {
  return html`<div class="empty">${icon(iconName)}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${raw(action)}</div>`.html;
}

export function pageHead(title, backTo) {
  return html`<div class="page-head">${backTo ? html`<a href="#${backTo}" class="back" aria-label="رجوع">${icon('back')}</a>` : ''}<h1>${title}</h1></div>`.html;
}

export function siteFooter() {
  const s = state.settings;
  const links = (s.footer_links || []).filter((l) => l.active !== false);
  const brand = s.brand_name && s.brand_name !== 'iQ Store' ? s.brand_name : 'ميثاق';
  return html`<footer class="site-foot">
    <img src="assets/logo-mark.png" alt="" width="40" height="32" style="opacity:.8">
    ${links.length ? html`<nav aria-label="روابط">${links.map((l) => html`<a href="#/page/${l.id}">${l.title}</a>`)}<a href="#/support">الدعم</a></nav>` : ''}
    <p>© ${new Date().getFullYear()} ${brand} — ${s.copyright_text || 'جميع الحقوق محفوظة'}</p>
  </footer>`.html;
}

// ربط أزرار الإضافة السريعة في أي شبكة منتجات
export function bindQuickAdd(root, getProduct) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    e.preventDefault();
    const p = await getProduct(b.dataset.add);
    if (!p) return;
    const pr = pricing(p);
    // المنتجات اللي تحتاج بيانات (ID لاعب...) أو كمية مرنة تفتح صفحة المنتج
    if (p.fieldEnabled !== false || pr.qtyMode) { location.hash = `#/p/${p.id}`; return; }
    const { addToCart } = await import('../services/cart.js');
    const { toast } = await import('../core/ui.js');
    addToCart(p, 1, '');
    toast(`تمت إضافة ${p.name} للسلة`);
  });
}
