// البحث
import { html, raw } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { search, product } from '../services/catalog.js';
import { productCard, skeletonGrid, empty, bindQuickAdd } from '../components/blocks.js';
import { debounce } from '../core/utils.js';

export default async function page(el, { params }) {
  const q0 = params.get('q') || '';
  el.innerHTML = html`<div class="page">
    <form class="search-bar" role="search" style="margin-top:0;margin-bottom:20px" id="sF">
      <div class="input-wrap">${icon('search')}<input class="input" name="q" value="${q0}" placeholder="ابحث عن بطاقة أو اشتراك" aria-label="بحث" autofocus></div>
    </form>
    <div id="res">${raw(skeletonGrid(4))}</div></div>`.html;
  const run = async (term) => {
    const box = el.querySelector('#res');
    if (!term.trim()) { box.innerHTML = empty('search', 'اكتب اسم اللعبة أو الخدمة'); return; }
    const list = await search(term);
    if (!el.contains(box)) return;
    box.innerHTML = list.length
      ? html`<p class="muted" style="margin-bottom:12px;font-size:var(--fs-sm)">${list.length} نتيجة</p><div class="products">${list.map(productCard)}</div>`.html
      : empty('search', 'ما لقينا شي', 'جرّب كلمة ثانية، مثلاً "ببجي" أو "نتفليكس".');
  };
  const input = el.querySelector('input');
  input.oninput = debounce(() => { history.replaceState(null, '', `#/search?q=${encodeURIComponent(input.value)}`); run(input.value); }, 300);
  el.querySelector('#sF').onsubmit = (e) => { e.preventDefault(); run(input.value); };
  bindQuickAdd(el, product);
  run(q0);
}
