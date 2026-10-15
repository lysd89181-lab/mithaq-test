// الصفحة الرئيسية
import { html, raw, esc, imgUrl, sanitizeHtml } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { state, subscribe } from '../core/state.js';
import { categories, bestSellers, heroSlides, product } from '../services/catalog.js';
import { productCard, skeletonGrid, siteFooter, bindQuickAdd } from '../components/blocks.js';
import { sheet } from '../core/ui.js';

let section = sessionStorage.getItem('mq_section') || 'cards';

const RIBBON = `<svg class="ribbon" viewBox="0 0 300 400" aria-hidden="true">
  <defs><linearGradient id="rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E3123F"/><stop offset="1" stop-color="#7E0A23"/></linearGradient></defs>
  <path d="M60 0 C 200 60, 260 160, 150 260 S 90 380, 230 420 L 300 420 L 300 0 Z" fill="url(#rb)" opacity=".9"/>
  <path d="M150 260 C 120 290, 110 330, 140 360 C 100 340, 90 290, 150 260 Z" fill="#4A0615" opacity=".7"/>
</svg>`;

function heroHtml(slides) {
  if (slides.length) {
    return html`<div class="hero" id="hero">
      ${slides.map((s, i) => html`<a class="hero-slide ${i === 0 ? 'on' : ''}" ${/^(https?:\/\/|#)/i.test(s.link || '') ? raw(`href="${esc(s.link)}"`) : ''} aria-hidden="${i !== 0}"><img src="${imgUrl(s.image)}" alt="" ${i ? raw('loading="lazy"') : ''}></a>`)}
      ${slides.length > 1 ? html`<div class="hero-dots">${slides.map((_, i) => html`<button class="${i === 0 ? 'on' : ''}" data-i="${i}" aria-label="الصورة ${i + 1}"></button>`)}</div>` : ''}
    </div>`;
  }
  return html`<div class="hero"><div class="hero-brand">${raw(RIBBON)}
    <h1>بطاقاتك واشتراكاتك، تصلك في ثواني</h1>
    <p>اشحن محفظتك بليبيانا أو مدار أو بايننس، واشتري وأنت مرتاح.</p></div></div>`;
}

export default async function home(el) {
  const s = state.settings;
  const tabs = (s.main_tabs || []).filter((t) => t.active !== false);
  if (tabs.length && !tabs.find((t) => t.id === section)) section = tabs[0].id;

  el.innerHTML = html`<div class="page">
    <div id="heroWrap"><div class="hero skel"></div></div>
    <div class="promise">
      <div>${icon('zap')}<span>تسليم فوري</span></div>
      <div>${icon('shield')}<span>دفع آمن</span></div>
      <div>${icon('headset')}<span>دعم 24/7</span></div>
    </div>
    <form class="search-bar mob-only" role="search" id="mSearch">
      <div class="input-wrap">${icon('search')}<input class="input" name="q" placeholder="ابحث عن بطاقة أو اشتراك" aria-label="بحث"></div>
    </form>
    <section class="section">
      <div class="section-head"><h2>الأقسام</h2></div>
      ${tabs.length > 1 ? html`<div class="segmented" style="margin-bottom:16px" role="tablist">${tabs.map((t) => html`<button role="tab" data-sec="${t.id}" class="${t.id === section ? 'active' : ''}" aria-selected="${t.id === section}">${t.title}</button>`)}</div>` : ''}
      <div id="cats">${raw(skeletonGrid(8, 'cats'))}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>الأكثر طلباً</h2><a href="#/categories">كل الأقسام</a></div>
      <div id="best">${raw(skeletonGrid(4))}</div>
    </section>
    ${raw(siteFooter())}
  </div>`.html;

  el.querySelector('#mSearch').onsubmit = (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  };

  // الأقسام
  const drawCats = async () => {
    const box = el.querySelector('#cats');
    try {
      const list = (await categories()).filter((c) => {
        const t = c.sectionType || 'cards';
        return section === 'smm' ? t === 'smm' : t !== 'smm';
      });
      box.innerHTML = list.length
        ? html`<div class="cats">${list.map((c) => html`<a class="cat" href="#/c/${c.id}">
            ${c.image || c.cover ? html`<img src="${imgUrl(c.image || c.cover)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : html`<span class="ph"></span>`}
            <span>${c.name || 'قسم'}</span></a>`)}</div>`.html
        : '<p class="muted">ما فيش أقسام هنا حالياً.</p>';
    } catch {
      box.innerHTML = '<p class="muted">تعذر تحميل الأقسام. حدّث الصفحة.</p>';
    }
  };
  drawCats();

  el.querySelectorAll('[data-sec]').forEach((b) => {
    b.onclick = () => {
      const pick = () => {
        section = b.dataset.sec;
        sessionStorage.setItem('mq_section', section);
        el.querySelectorAll('[data-sec]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
        drawCats();
      };
      if (b.dataset.sec === 'smm' && s.smm_warning_text && !sessionStorage.getItem('mq_smm_ok')) {
        const sh = sheet('قبل ما تكمل', `<div class="rich" style="margin-bottom:16px">${sanitizeHtml(s.smm_warning_text)}</div>
          <button class="btn btn-primary btn-block" id="smmOk">فهمت، كمّل</button>`);
        sh.el.querySelector('#smmOk').onclick = () => { sessionStorage.setItem('mq_smm_ok', '1'); sh.close(); pick(); };
      } else pick();
    };
  });

  // الواجهة
  let timer;
  heroSlides().then((list) => {
    // بدون صور في الإعدادات: نعرض بنر ميثاق الافتراضي
    const slides = list.length ? list : [{ image: new URL('assets/banner-1.jpg', location.href).href, link: '#/categories' }];
    const wrap = el.querySelector('#heroWrap');
    if (!wrap) return;
    wrap.innerHTML = heroHtml(slides).html;
    if (slides.length > 1) {
      let i = 0;
      const show = (n) => {
        i = n;
        wrap.querySelectorAll('.hero-slide').forEach((x, k) => { x.classList.toggle('on', k === i); x.setAttribute('aria-hidden', k !== i); });
        wrap.querySelectorAll('.hero-dots button').forEach((x, k) => x.classList.toggle('on', k === i));
      };
      wrap.querySelectorAll('.hero-dots button').forEach((d) => { d.onclick = () => { show(Number(d.dataset.i)); }; });
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => show((i + 1) % slides.length), 5000);
    }
  });

  // الأكثر طلباً
  bestSellers(8).then((list) => {
    const box = el.querySelector('#best');
    if (box) box.innerHTML = list.length ? html`<div class="products">${list.map(productCard)}</div>`.html : '<p class="muted">قريباً.</p>';
  }).catch(() => {});
  bindQuickAdd(el, product);

  const off = subscribe((st, patch) => { if ('currency' in patch) bestSellers(8).then((list) => { const box = el.querySelector('#best'); if (box) box.innerHTML = html`<div class="products">${list.map(productCard)}</div>`.html; }); });
  return () => { clearInterval(timer); off(); };
}
