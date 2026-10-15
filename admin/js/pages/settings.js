// إعدادات المنصة (app/settings) + شريط الصور (settings/hero_slides)
import { db, doc, getDoc, setDoc, serverTimestamp } from '../../../js/core/firebase.js';
import { html, raw, imgUrl } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { toast, toastErr, withLoading } from '../../../js/core/ui.js';
import { sw, audit } from '../kit.js';

const DEF_METHODS = [{ id: 'libyana', title: 'ليبيانا ومدار', active: true }, { id: 'binance', title: 'بايننس', active: true }, { id: 'cards', title: 'كروت تعبئة', active: true }];
const DEF_TABS = [{ id: 'cards', title: 'اشتراكات وألعاب', active: true }, { id: 'smm', title: 'خدمات السوشيال', active: true }];
const DEF_PAGES = [
  { id: 'about', title: 'من نحن', icon: 'info-circle', active: true, content: '<p><b>ميثاق</b> منصة ليبية للبطاقات الرقمية والاشتراكات.</p>' },
  { id: 'faq', title: 'الأسئلة الشائعة', icon: 'question-circle', active: true, content: '<p><b>كم ياخذ تنفيذ الطلب؟</b><br>من دقيقة إلى 3 ساعات.</p>' },
  { id: 'contact', title: 'اتصل بنا', icon: 'phone-alt', active: true, content: '' },
  { id: 'rights', title: 'الشروط والأحكام', icon: 'shield-alt', active: true, content: '<p>المنتجات الرقمية غير قابلة للاسترداد بعد التسليم.</p>' },
];

export default async function page(el) {
  el.innerHTML = '<div class="skel" style="height:400px"></div>';
  const [sd, hd] = await Promise.all([getDoc(doc(db, 'app', 'settings')), getDoc(doc(db, 'settings', 'hero_slides'))]);
  const s = sd.exists() ? sd.data() : {};
  const st = {
    methods: s.payment_methods?.length ? s.payment_methods.map((m) => ({ ...m, title: (m.title || '').replace(/^[^\p{L}]+/u, '') })) : DEF_METHODS,
    tabs: s.main_tabs?.length ? s.main_tabs : DEF_TABS,
    numbers: s.libyana_numbers || [],
    channels: s.support_channels || [],
    pages: s.trust_sections?.length ? s.trust_sections : DEF_PAGES,
    footer: s.footer_links || [],
    slides: hd.exists() ? hd.data().slides || [] : [],
  };
  const brand = s.brand_name && s.brand_name !== 'iQ Store' ? s.brand_name : 'ميثاق';

  el.innerHTML = html`<form id="f" class="stack-lg">
    <section class="panel form-grid"><div class="panel-title"><h2>معلومات المنصة</h2></div>
      <div class="split even">
        <div class="field"><label>اسم المنصة</label><input class="input" id="brand" value="${brand}"></div>
        <div class="field"><label>نص الحقوق</label><input class="input" id="copy" value="${s.copyright_text || 'جميع الحقوق محفوظة'}"></div>
        <div class="field"><label>مدة المعالجة (تظهر للزبون)</label><input class="input" id="ptime" value="${s.processing_time || 'من دقيقة إلى 3 ساعات'}"></div>
        <div class="field"><label>سعر الدولار للعرض (د.ل)</label><input class="input ltr" dir="ltr" type="number" step="0.01" id="usd" value="${s.usd_rate || s.binance_rate || 11}"></div>
      </div>
      ${raw(sw('verify', s.require_email_verification !== false, 'تأكيد البريد الإلكتروني إجباري قبل الشراء والشحن').html)}
    </section>

    <section class="panel form-grid"><div class="panel-title"><h2>الدفع والشحن</h2></div>
      <div class="stack">${st.methods.map((m, i) => html`<label class="toggle-row"><span>${m.title || m.id}</span><span class="switch"><input type="checkbox" data-method="${i}" ${m.active !== false ? raw('checked') : ''}><span></span></span></label>`)}</div>
      <div class="split even">
        <div class="field"><label>معرّف Binance</label><input class="input ltr" dir="ltr" id="bid" value="${s.binance_id || ''}"></div>
        <div class="field"><label>سعر صرف Binance (د.ل لكل 1$)</label><input class="input ltr" dir="ltr" type="number" step="0.01" id="brate" value="${s.binance_rate || 11}"></div>
        <div class="field"><label>أقل مبلغ شحن (د.ل)</label><input class="input ltr" dir="ltr" type="number" step="0.01" id="dmin" value="${s.min_deposit ?? 1}"></div>
        <div class="field"><label>أكبر مبلغ شحن (د.ل)</label><input class="input ltr" dir="ltr" type="number" step="1" id="dmax" value="${s.max_deposit ?? 20000}"></div>
      </div>
      <div class="field"><label>أرقام ليبيانا ومدار</label><div class="stack" id="numbers"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="addNum" style="justify-self:start">${icon('plus', 'sm')}<span>إضافة رقم</span></button></div>
    </section>

    <section class="panel form-grid"><div class="panel-title"><h2>شريط الصور في الرئيسية</h2></div>
      <p class="hint">المقاس المناسب 1600×700. الصورة تكون رابط مباشر أو اسم ملف في مستودع الصور.</p>
      <div class="stack" id="slides"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="addSlide" style="justify-self:start">${icon('plus', 'sm')}<span>إضافة صورة</span></button>
    </section>

    <section class="panel form-grid"><div class="panel-title"><h2>شريط التنبيه أعلى الموقع</h2></div>
      ${raw(sw('banner', s.emergency_banner?.active === true, 'إظهار شريط التنبيه').html)}
      <div class="field"><label>نص التنبيه</label><input class="input" id="bannerMsg" value="${s.emergency_banner?.message || ''}" placeholder="مثلاً: صيانة لمدة ساعة، الطلبات تتنفذ بعدها"></div>
    </section>

    <section class="panel form-grid"><div class="panel-title"><h2>أقسام الرئيسية</h2></div>
      <div class="stack">${st.tabs.map((t, i) => html`<div class="repeat-row"><input class="input" data-tab-title="${i}" value="${t.title}"><span class="switch"><input type="checkbox" data-tab="${i}" ${t.active !== false ? raw('checked') : ''} aria-label="ظاهر"><span></span></span></div>`)}</div>
      <div class="field"><label>رسالة التنبيه قبل دخول خدمات السوشيال</label><textarea class="textarea" id="smm">${s.smm_warning_text || ''}</textarea></div>
    </section>

    <section class="panel form-grid"><div class="panel-title"><h2>قنوات الدعم</h2></div>
      <div class="stack" id="channels"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="addCh" style="justify-self:start">${icon('plus', 'sm')}<span>إضافة قناة</span></button>
    </section>

    <section class="panel form-grid"><div class="panel-title"><h2>صفحات المعلومات</h2></div>
      <p class="hint">مسموح وسوم بسيطة: &lt;p&gt; &lt;b&gt; &lt;br&gt; &lt;ul&gt; &lt;li&gt; &lt;a&gt;. أي شي ثاني يتشال تلقائياً.</p>
      <div class="stack" id="pages"></div>
    </section>

    <button class="btn btn-primary btn-block sticky-save"><span class="label">${icon('check', 'sm')} حفظ كل الإعدادات</span><span class="spin"></span></button>
  </form>`.html;

  const f = el.querySelector('#f');
  const del = (arr, i, redraw) => () => { arr.splice(i, 1); redraw(); };

  function drawNumbers() {
    const box = f.querySelector('#numbers');
    box.innerHTML = st.numbers.map((n, i) => html`<div class="repeat-row"><div class="fields">
      <input class="input" data-n="${i}" data-k="label" value="${n.label || ''}" placeholder="ليبيانا">
      <input class="input ltr" dir="ltr" data-n="${i}" data-k="number" value="${n.number || ''}" placeholder="09XXXXXXXX"></div>
      <div class="row"><span class="switch"><input type="checkbox" data-n="${i}" data-k="active" ${n.active !== false ? raw('checked') : ''} aria-label="فعّال"><span></span></span><button type="button" class="icon-btn" data-x="${i}" aria-label="حذف">${icon('trash', 'sm')}</button></div></div>`.html).join('') || '<p class="hint">ما فيش أرقام.</p>';
    box.querySelectorAll('[data-x]').forEach((b) => { b.onclick = del(st.numbers, Number(b.dataset.x), drawNumbers); });
  }
  function drawSlides() {
    const box = f.querySelector('#slides');
    box.innerHTML = st.slides.map((x, i) => html`<div class="repeat-row"><div class="fields">
      ${x.image ? html`<img src="${imgUrl(x.image)}" alt="" style="width:100%;max-width:220px;aspect-ratio:16/7;object-fit:cover;border-radius:10px;grid-column:1/-1">` : ''}
      <input class="input ltr" dir="ltr" data-s="${i}" data-k="image" value="${x.image || ''}" placeholder="رابط الصورة">
      <input class="input ltr" dir="ltr" data-s="${i}" data-k="link" value="${x.link || ''}" placeholder="رابط عند الضغط (اختياري، مثلاً #/c/ID)"></div>
      <div class="row"><span class="switch"><input type="checkbox" data-s="${i}" data-k="active" ${x.active !== false ? raw('checked') : ''} aria-label="ظاهر"><span></span></span><button type="button" class="icon-btn" data-x="${i}" aria-label="حذف">${icon('trash', 'sm')}</button></div></div>`.html).join('') || '<p class="hint">ما فيش صور، تظهر واجهة ميثاق الافتراضية.</p>';
    box.querySelectorAll('[data-x]').forEach((b) => { b.onclick = del(st.slides, Number(b.dataset.x), drawSlides); });
  }
  function drawChannels() {
    const box = f.querySelector('#channels');
    box.innerHTML = st.channels.map((c, i) => html`<div class="repeat-row"><div class="fields">
      <select class="select" data-c="${i}" data-k="type">${['whatsapp', 'telegram', 'instagram'].map((t) => html`<option value="${t}" ${c.type === t ? raw('selected') : ''}>${{ whatsapp: 'واتساب', telegram: 'تيليجرام', instagram: 'انستغرام' }[t]}</option>`)}</select>
      <input class="input" data-c="${i}" data-k="title" value="${c.title || ''}" placeholder="العنوان">
      <input class="input ltr" dir="ltr" data-c="${i}" data-k="url" value="${c.url || ''}" placeholder="https://wa.me/218…"></div>
      <div class="row"><span class="switch"><input type="checkbox" data-c="${i}" data-k="active" ${c.active !== false ? raw('checked') : ''} aria-label="ظاهر"><span></span></span><button type="button" class="icon-btn" data-x="${i}" aria-label="حذف">${icon('trash', 'sm')}</button></div></div>`.html).join('');
    box.querySelectorAll('[data-x]').forEach((b) => { b.onclick = del(st.channels, Number(b.dataset.x), drawChannels); });
  }
  function drawPages() {
    f.querySelector('#pages').innerHTML = st.pages.map((p, i) => html`<div class="form-section">
      <div class="row"><input class="input" data-p="${i}" data-k="title" value="${p.title || ''}"><span class="switch"><input type="checkbox" data-p="${i}" data-k="active" ${p.active !== false ? raw('checked') : ''} aria-label="ظاهر"><span></span></span></div>
      <textarea class="textarea ltr" dir="auto" rows="4" data-p="${i}" data-k="content">${p.content || ''}</textarea></div>`.html).join('');
  }
  // قراءة القيم من الحقول للمصفوفات
  f.addEventListener('input', (e) => sync(e.target));
  f.addEventListener('change', (e) => sync(e.target));
  function sync(t) {
    const k = t.dataset.k;
    const val = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.n !== undefined) st.numbers[t.dataset.n][k] = val;
    if (t.dataset.s !== undefined) st.slides[t.dataset.s][k] = val;
    if (t.dataset.c !== undefined) st.channels[t.dataset.c][k] = val;
    if (t.dataset.p !== undefined) st.pages[t.dataset.p][k] = val;
    if (t.dataset.method !== undefined) st.methods[t.dataset.method].active = t.checked;
    if (t.dataset.tab !== undefined) st.tabs[t.dataset.tab].active = t.checked;
    if (t.dataset.tabTitle !== undefined) st.tabs[t.dataset.tabTitle].title = t.value;
  }
  f.querySelector('#addNum').onclick = () => { st.numbers.push({ label: '', number: '', active: true }); drawNumbers(); };
  f.querySelector('#addSlide').onclick = () => { st.slides.push({ image: '', link: '', active: true }); drawSlides(); };
  f.querySelector('#addCh').onclick = () => { st.channels.push({ type: 'whatsapp', title: '', url: '', active: true }); drawChannels(); };
  drawNumbers(); drawSlides(); drawChannels(); drawPages();

  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading(f.querySelector('.sticky-save'), async () => {
      const g = (id) => f.querySelector(`#${id}`);
      const data = {
        brand_name: g('brand').value.trim() || 'ميثاق',
        copyright_text: g('copy').value.trim(),
        processing_time: g('ptime').value.trim(),
        usd_rate: Number(g('usd').value) || 11,
        require_email_verification: f.querySelector('[name="verify"]').checked,
        payment_methods: st.methods,
        binance_id: g('bid').value.trim(),
        binance_rate: Number(g('brate').value) || 11,
        min_deposit: Number(g('dmin').value) || 1,
        max_deposit: Number(g('dmax').value) || 20000,
        libyana_numbers: st.numbers.filter((n) => n.number),
        emergency_banner: { active: f.querySelector('[name="banner"]').checked, message: g('bannerMsg').value.trim(), bg_color: '#E3123F' },
        main_tabs: st.tabs,
        smm_warning_text: g('smm').value,
        support_channels: st.channels.filter((c) => c.url),
        trust_sections: st.pages,
        footer_links: st.pages.map((p) => ({ id: p.id, title: p.title, active: p.active !== false })),
        updatedAt: serverTimestamp(),
      };
      try {
        await setDoc(doc(db, 'app', 'settings'), data, { merge: true });
        await setDoc(doc(db, 'settings', 'hero_slides'), { slides: st.slides.filter((x) => x.image), updatedAt: serverTimestamp() });
        audit('settings_saved');
        toast('تم حفظ الإعدادات، وتظهر للزبائن فوراً');
      } catch (err) { toastErr(err); }
    });
  };
}
