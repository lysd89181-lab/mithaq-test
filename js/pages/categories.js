// كل الأقسام
import { html, imgUrl } from '../core/utils.js';
import { categories } from '../services/catalog.js';
import { pageHead, siteFooter, skeletonGrid } from '../components/blocks.js';

export default async function page(el) {
  el.innerHTML = `<div class="page">${pageHead('الأقسام')}<div id="list">${skeletonGrid(9, 'cats')}</div>${siteFooter()}</div>`;
  const list = await categories();
  const groups = [
    { title: 'اشتراكات وألعاب', items: list.filter((c) => (c.sectionType || 'cards') !== 'smm') },
    { title: 'خدمات السوشيال', items: list.filter((c) => c.sectionType === 'smm') },
  ].filter((g) => g.items.length);
  el.querySelector('#list').innerHTML = groups.map((g, i) => html`<section class="${i ? 'section' : ''}">
    ${groups.length > 1 ? html`<div class="section-head"><h2>${g.title}</h2></div>` : ''}
    <div class="cats">${g.items.map((c) => html`<a class="cat" href="#/c/${c.id}">
      ${c.image || c.cover ? html`<img src="${imgUrl(c.image || c.cover)}" alt="" loading="lazy">` : html`<span class="ph"></span>`}
      <span>${c.name || 'قسم'}</span></a>`)}</div></section>`.html).join('') || '<p class="muted">ما فيش أقسام حالياً.</p>';
}
