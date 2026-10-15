// السلة والدفع
import { html, raw, imgUrl, money3, uid, copyText, esc } from '../core/utils.js';
import { icon, iconStr } from '../core/icons.js';
import { state, fmt, subscribe, whenAuth } from '../core/state.js';
import { resolveCart, setQty, removeAt, clearCart } from '../services/cart.js';
import { api } from '../core/api.js';
import { toast, toastErr, sheet, withLoading } from '../core/ui.js';
import { pageHead, empty, priceHtml } from '../components/blocks.js';
import { auth, sendEmailVerification } from '../core/firebase.js';

let coupon = null; // {code, discount, label}
const newCheckoutId = () => { const id = `${Date.now().toString(36)}${uid(10)}`; sessionStorage.setItem('mq_checkout', id); return id; };
const checkoutId = () => sessionStorage.getItem('mq_checkout') || newCheckoutId();

export default async function page(el) {
  el.innerHTML = `<div class="page">${pageHead('السلة')}<div class="skel" style="height:220px"></div></div>`;
  await whenAuth();

  const draw = async () => {
    const rows = await resolveCart();
    if (!rows.length) {
      el.innerHTML = `<div class="page">${pageHead('السلة')}${empty('cart', 'سلتك فاضية', 'تصفح الأقسام وأضف اللي تبيه.', '<a class="btn btn-primary" href="#/categories">تصفح الأقسام</a>')}</div>`;
      return;
    }
    const subtotal = money3(rows.reduce((s, r) => s + r.total, 0));
    const discount = coupon ? Math.min(coupon.discount, subtotal) : 0;
    const total = money3(subtotal - discount);
    const balance = Number(state.profile?.balance) || 0;
    const user = state.user;
    const unverified = user && !user.emailVerified && state.settings.require_email_verification !== false;
    const short = user && balance < total;
    const phone = localStorage.getItem('mq_phone') || state.profile?.phone || '';

    el.innerHTML = html`<div class="page">
      ${raw(pageHead('السلة'))}
      <div class="two-col">
        <section class="panel" aria-label="المنتجات">
          <div class="list">${rows.map((r, i) => html`<div class="cart-item">
            <img class="thumb" src="${imgUrl(r.product.image || r.product.img)}" alt="" onerror="this.style.visibility='hidden'">
            <div class="stack" style="gap:6px">
              <div class="row between" style="align-items:flex-start">
                <a href="#/p/${r.product.id}" class="title" style="font-weight:600">${r.product.name}</a>
                <button class="icon-btn" data-rm="${i}" aria-label="حذف ${r.product.name}" style="width:32px;height:32px">${icon('trash', 'sm')}</button>
              </div>
              ${r.data ? html`<div class="hint ltr" style="text-align:right">${r.data}</div>` : ''}
              <div class="row between">
                <div class="stepper"><button data-dec="${i}" aria-label="إنقاص">${icon('minus', 'sm')}</button>
                  <input type="number" value="${r.qty}" data-qty="${i}" min="${r.pr.qtyMin}" max="${r.pr.qtyMax}" aria-label="الكمية">
                  <button data-inc="${i}" aria-label="زيادة">${icon('plus', 'sm')}</button></div>
                <b class="price" style="font-size:var(--fs-md)">${raw(priceHtml(r.total))}</b>
              </div>
            </div></div>`)}</div>
        </section>

        <aside class="stack">
          <div class="panel stack">
            <div class="field"><label for="cPhone">رقم للتواصل (واتساب)</label>
              <input id="cPhone" class="input ltr" dir="ltr" inputmode="tel" placeholder="09XXXXXXXX" value="${phone}" maxlength="20"></div>
            <div class="field"><label for="cCoupon">كوبون خصم</label>
              <div class="row"><input id="cCoupon" class="input ltr" dir="ltr" placeholder="CODE" value="${coupon ? coupon.code : ''}" style="text-transform:uppercase">
              ${coupon ? html`<button class="btn btn-ghost" id="cCouponRm">إزالة</button>` : html`<button class="btn btn-ghost" id="cCouponGo"><span class="label">تطبيق</span><span class="spin"></span></button>`}</div>
              ${coupon ? html`<span class="hint" style="color:var(--ok)">تم تطبيق خصم ${coupon.label}</span>` : ''}</div>
          </div>
          <div class="panel">
            <div class="summary-row"><span>المجموع</span><span class="num">${fmt(subtotal)}</span></div>
            ${discount ? html`<div class="summary-row" style="color:var(--ok)"><span>الخصم</span><span class="num">-${fmt(discount)}</span></div>` : ''}
            <div class="summary-row total"><span>الإجمالي</span><span class="num">${fmt(total)}</span></div>
            ${user ? html`<div class="summary-row"><span>رصيدك</span><span class="num" style="color:${short ? 'var(--bad)' : 'var(--paper)'}">${fmt(balance)}</span></div>` : ''}
            <div style="margin-top:14px" class="stack">
              ${!user ? html`<a class="btn btn-primary btn-block" href="auth/?next=${encodeURIComponent('#/cart')}">سجّل دخولك لإتمام الشراء</a>`
                : unverified ? html`<div class="banner warn">${icon('mail')}<span>أكّد بريدك الإلكتروني قبل أول عملية شراء.</span></div>
                  <button class="btn btn-ghost btn-block" id="cVerify">إرسال رابط التأكيد من جديد</button>
                  <button class="btn btn-primary btn-block" id="cRecheck">أكدت بريدي</button>`
                : short ? html`<a class="btn btn-primary btn-block" href="#/wallet">${icon('wallet')}<span>اشحن ${fmt(money3(total - balance))} لإتمام الشراء</span></a>`
                : html`<button class="btn btn-primary btn-block" id="cPay"><span class="label">ادفع ${fmt(total)} من محفظتك</span><span class="spin"></span></button>`}
              <button class="btn btn-ghost btn-sm" id="cClear" style="justify-self:center">تفريغ السلة</button>
            </div>
          </div>
        </aside>
      </div>
    </div>`.html;
    bind(rows, total);
  };

  function bind(rows, total) {
    const q = (sel) => el.querySelector(sel);
    el.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { removeAt(Number(b.dataset.rm)); coupon = null; draw(); }; });
    const step = (i, dir) => {
      const r = rows[i];
      const by = r.pr.qtyMode ? Math.max(1, Math.round(r.pr.qtyMin / 2)) : 1;
      setQty(i, Math.min(Math.max(r.qty + dir * by, r.pr.qtyMin), r.pr.qtyMax));
      coupon = null;
      draw();
    };
    el.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => step(Number(b.dataset.dec), -1); });
    el.querySelectorAll('[data-inc]').forEach((b) => { b.onclick = () => step(Number(b.dataset.inc), 1); });
    el.querySelectorAll('[data-qty]').forEach((inp) => {
      inp.onchange = () => {
        const r = rows[Number(inp.dataset.qty)];
        setQty(Number(inp.dataset.qty), Math.min(Math.max(Math.floor(Number(inp.value) || r.pr.qtyMin), r.pr.qtyMin), r.pr.qtyMax));
        coupon = null;
        draw();
      };
    });
    q('#cClear').onclick = () => { clearCart(); coupon = null; draw(); };
    q('#cPhone').onchange = (e) => localStorage.setItem('mq_phone', e.target.value.trim());
    if (q('#cCouponRm')) q('#cCouponRm').onclick = () => { coupon = null; draw(); };
    if (q('#cCouponGo')) {
      q('#cCouponGo').onclick = (e) => withLoading(e.currentTarget, async () => {
        const code = q('#cCoupon').value.trim().toUpperCase();
        if (!code) return toast('أدخل كود الكوبون', 'err');
        if (!state.user) return toast('سجل دخولك أولاً لاستخدام الكوبون', 'err');
        try {
          const r = await api('/v1/coupon/check', { code, items: state.cart.map(({ productId, qty }) => ({ productId, qty })) });
          coupon = { code: r.code, discount: r.discount, label: r.label };
          toast(`تم تطبيق الكوبون: خصم ${fmt(r.discount)}`);
          draw();
        } catch (err) { toastErr(err); }
      });
    }
    if (q('#cVerify')) {
      q('#cVerify').onclick = async () => {
        try {
          await sendEmailVerification(auth.currentUser, { url: location.href.split('#')[0] + '#/cart' });
          toast('بعثنا رابط التأكيد لبريدك، افتحه وارجع هنا');
        } catch (err) { toastErr(err.code === 'auth/too-many-requests' ? new Error('استنى شوية قبل ما تطلب رابط جديد') : err); }
      };
      q('#cRecheck').onclick = async () => {
        await auth.currentUser.reload();
        await auth.currentUser.getIdToken(true);
        if (auth.currentUser.emailVerified) { toast('تم تأكيد بريدك'); draw(); } else toast('البريد مازال غير مؤكد. افتح الرابط اللي وصلك', 'err');
      };
    }
    if (q('#cPay')) q('#cPay').onclick = (e) => withLoading(e.currentTarget, () => pay(total));
  }

  async function pay(total) {
    const phone = el.querySelector('#cPhone').value.trim();
    if (phone.length < 6) { el.querySelector('#cPhone').focus(); return toast('أدخل رقم للتواصل', 'err'); }
    localStorage.setItem('mq_phone', phone);
    try {
      const r = await api('/v1/checkout', {
        checkoutId: checkoutId(),
        items: state.cart.map(({ productId, qty, data }) => ({ productId, qty, data })),
        contactPhone: phone,
        coupon: coupon ? coupon.code : '',
      });
      newCheckoutId();
      clearCart();
      coupon = null;
      showReceipt(r);
      draw();
    } catch (err) {
      if (err.code === 'duplicate') { newCheckoutId(); clearCart(); toast('تم تنفيذ الطلب مسبقاً، راجع طلباتك', 'info'); location.hash = '#/orders'; return; }
      if (err.code === 'product_unavailable' || err.code?.startsWith('coupon')) { coupon = null; draw(); }
      toastErr(err);
    }
  }

  function showReceipt(r) {
    const s = sheet('تم الطلب بنجاح', html`
      <div class="stack">
        <div class="banner info" style="justify-content:space-between"><span>المدفوع</span><b class="num">${fmt(r.total)}</b></div>
        ${r.orders.map((o) => html`<div class="panel stack" style="padding:14px;gap:8px">
          <div class="row between"><b>${o.productName}</b><span class="badge ${o.status === 'completed' ? 'ok' : 'wait'}">${o.status === 'completed' ? 'تم التسليم' : 'قيد التنفيذ'}</span></div>
          <span class="hint num" style="text-align:right">${o.invoiceNumber}</span>
          ${o.deliveredData ? html`<div class="code-box"><pre>${o.deliveredData}</pre><button class="icon-btn" data-copy="${encodeURIComponent(o.deliveredData)}" aria-label="نسخ">${icon('copy')}</button></div>` : html`<p class="hint">نبلغوك بإشعار أول ما يتنفذ.</p>`}
        </div>`)}
        <div class="row"><a class="btn btn-primary" style="flex:1" href="#/orders" data-close>طلباتي</a><button class="btn btn-ghost" style="flex:1" data-close>إغلاق</button></div>
      </div>`.html);
    s.el.querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = async () => { if (await copyText(decodeURIComponent(b.dataset.copy))) { b.innerHTML = iconStr('check'); toast('تم النسخ'); } };
    });
  }

  await draw();
  return subscribe((s, p) => { if ('currency' in p || ('profile' in p && !el.querySelector('#cPay:disabled'))) draw(); });
}
