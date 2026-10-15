// صفحة القسم
import { html, imgUrl } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { subscribe } from '../core/state.js';
import { category, productsOf, product } from '../services/catalog.js';
import { productCard, skeletonGrid, empty, bindQuickAdd } from '../components/blocks.js';

export default async function page(el, { match: [id] }) {
  el.innerHTML = `<div class="page"><div class="skel" style="height:104px;margin-bottom:20px"></div>${skeletonGrid(6)}</div>`;
  const [cat, list] = await Promise.all([category(id), productsOf(id)]);
  if (!cat) { el.innerHTML = `<div class="page">${empty('grid', 'القسم غير موجود', '', '<a class="btn btn-ghost" href="#/categories">كل الأقسام</a>')}</div>`; return; }
  const draw = () => {
    el.innerHTML = html`<div class="page">
      <div class="cat-hero">
        <a href="#/categories" class="icon-btn" aria-label="رجوع">${icon('back')}</a>
        ${cat.image || cat.cover ? html`<img src="${imgUrl(cat.image || cat.cover)}" alt="">` : ''}
        <div><h1>${cat.name}</h1><p class="muted" style="font-size:var(--fs-sm)">${list.length} منتج</p></div>
      </div>
      ${list.length ? html`<div class="products">${list.map(productCard)}</div>` : ''}
    </div>`.html;
    if (!list.length) el.querySelector('.page').insertAdjacentHTML('beforeend', empty('box', 'ما فيش منتجات هنا حالياً', 'ارجع بعد شوية، نضيفوا منتجات باستمرار.'));
  };
  draw();
  bindQuickAdd(el, product);
  return subscribe((s, p) => { if ('currency' in p) draw(); });
}
