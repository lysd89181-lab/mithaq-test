// حسابي
import { html, raw } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { state, set, fmt, subscribe } from '../core/state.js';
import { auth, signOut, sendEmailVerification, db, doc, updateDoc } from '../core/firebase.js';
import { toast, toastErr, sheet, withLoading } from '../core/ui.js';
import { enablePush, disablePush, pushState, pushSupported } from '../services/push.js';
import { siteFooter } from '../components/blocks.js';

export default async function page(el) {
  const draw = async () => {
    const u = state.user;
    const p = state.profile || {};
    const pages = (state.settings.trust_sections || []).filter((t) => t.active !== false);
    const canPush = await pushSupported();
    const pushOn = pushState() === 'granted' && !!localStorage.getItem('mq_push_token');
    const name = p.name || p.username || u?.displayName || '';

    el.innerHTML = html`<div class="page" style="max-width:720px">
      ${u ? html`<section class="panel stack-lg">
        <div class="profile">
          <div class="avatar">${(name || u.email || '؟').trim().slice(0, 1)}</div>
          <div class="grow" style="min-width:0"><h1 style="font-size:var(--fs-lg)">${name || 'حسابي'}</h1>
            <p class="muted ltr" style="font-size:var(--fs-sm);text-align:right;overflow-wrap:anywhere">${u.email}</p></div>
        </div>
        ${!u.emailVerified ? html`<div class="banner warn">${icon('mail')}<span style="flex:1">بريدك غير مؤكد. أكّده باش تقدر تشتري.</span><button class="btn btn-sm btn-outline" id="aVerify">إرسال الرابط</button></div>` : ''}
        <a href="#/wallet" class="balance-card" style="padding:18px;display:flex;align-items:center;justify-content:space-between">
          <div><span class="muted" style="font-size:var(--fs-sm)">رصيدك</span><div class="num" style="font-family:var(--font-display);font-size:var(--fs-xl);font-weight:800">${fmt(p.balance || 0)}</div></div>
          <span class="btn btn-primary btn-sm">${icon('plus', 'sm')}<span>شحن</span></span></a>
      </section>` : html`<section class="panel stack" style="text-align:center;justify-items:center">
        <img src="assets/logo.png" alt="ميثاق" width="120" style="width:120px">
        <p class="muted">سجّل دخولك باش تشتري وتتابع طلباتك.</p>
        <div class="row" style="width:100%"><a class="btn btn-primary" style="flex:1" href="auth/?next=%23%2Faccount">تسجيل الدخول</a><a class="btn btn-ghost" style="flex:1" href="auth/?mode=register&next=%23%2Faccount">حساب جديد</a></div>
      </section>`}

      <section class="panel menu-list" style="margin-top:16px;padding-block:4px">
        ${u ? html`<a href="#/orders">${icon('receipt')}<span>طلباتي</span><span class="end">${icon('next', 'sm')}</span></a>
        <a href="#/wallet">${icon('wallet')}<span>المحفظة والمعاملات</span><span class="end">${icon('next', 'sm')}</span></a>
        <a href="#/notifications">${icon('bell')}<span>الإشعارات</span>${state.unread ? html`<span class="badge red">${state.unread}</span>` : ''}<span class="end">${icon('next', 'sm')}</span></a>
        <button id="aName">${icon('edit')}<span>تعديل الاسم ورقم الهاتف</span><span class="end">${icon('next', 'sm')}</span></button>` : ''}
        ${u && canPush ? html`<div class="row" style="padding:12px 4px;border-bottom:1px solid var(--line-soft)">${icon('bell')}<span class="grow">إشعارات الطلبات على الجهاز</span>
          <label class="switch"><input type="checkbox" id="aPush" ${pushOn ? raw('checked') : ''} aria-label="تفعيل الإشعارات"><span></span></label></div>` : ''}
        <div class="row" style="padding:12px 4px;border-bottom:1px solid var(--line-soft)">${icon('coin')}<span class="grow">عملة العرض</span>
          <div class="segmented" style="padding:3px;flex:none;width:auto"><button data-cur="LYD" class="${state.currency === 'LYD' ? 'active' : ''}">د.ل</button><button data-cur="USD" class="${state.currency === 'USD' ? 'active' : ''}">$</button></div></div>
        <a href="#/support">${icon('headset')}<span>الدعم الفني</span><span class="end">${icon('next', 'sm')}</span></a>
        ${pages.map((t) => html`<a href="#/page/${t.id}">${icon(t.id === 'faq' ? 'help' : t.id === 'contact' ? 'phone' : t.id === 'rights' ? 'shield' : 'info')}<span>${t.title}</span><span class="end">${icon('next', 'sm')}</span></a>`)}
        ${state.isStaff ? html`<a href="admin/">${icon('settings')}<span>لوحة التحكم</span><span class="end">${icon('external', 'sm')}</span></a>` : ''}
        ${u ? html`<button id="aOut" style="color:var(--bad)">${icon('logout')}<span>تسجيل الخروج</span></button>` : ''}
      </section>
      ${raw(siteFooter())}
    </div>`.html;
    bind();
  };

  function bind() {
    const q = (s) => el.querySelector(s);
    el.querySelectorAll('[data-cur]').forEach((b) => { b.onclick = () => { set({ currency: b.dataset.cur }); }; });
    if (q('#aOut')) q('#aOut').onclick = async () => { await disablePush().catch(() => {}); await signOut(auth); toast('تم تسجيل الخروج'); location.hash = '#/'; };
    if (q('#aVerify')) {
      q('#aVerify').onclick = (e) => withLoading(e.currentTarget, async () => {
        try {
          await sendEmailVerification(auth.currentUser, { url: location.href.split('#')[0] + '#/account' });
          toast('بعثنا رابط التأكيد لبريدك. افتحه وارجع هنا');
        } catch (err) { toastErr(err.code === 'auth/too-many-requests' ? new Error('استنى شوية قبل ما تطلب رابط جديد') : err); }
      });
    }
    if (q('#aPush')) {
      q('#aPush').onchange = async (e) => {
        const on = e.target.checked;
        e.target.disabled = true;
        try {
          if (on) { await enablePush(); toast('تم تفعيل الإشعارات'); } else { await disablePush(); toast('تم إيقاف الإشعارات'); }
        } catch (err) { e.target.checked = !on; toastErr(err); }
        e.target.disabled = false;
      };
    }
    if (q('#aName')) {
      q('#aName').onclick = () => {
        const p = state.profile || {};
        const s = sheet('بياناتي', html`<form class="stack" id="fName">
          <div class="field"><label for="nN">الاسم</label><input id="nN" class="input" value="${p.name || ''}" maxlength="60" required></div>
          <div class="field"><label for="nP">رقم الهاتف</label><input id="nP" class="input ltr" dir="ltr" inputmode="tel" value="${p.phone || ''}" maxlength="20"></div>
          <button class="btn btn-primary btn-block"><span class="label">حفظ</span><span class="spin"></span></button></form>`.html);
        s.el.querySelector('#fName').onsubmit = (e) => {
          e.preventDefault();
          withLoading(e.target.querySelector('button'), async () => {
            try {
              const phone = s.el.querySelector('#nP').value.trim();
              await updateDoc(doc(db, 'users', state.user.uid), { name: s.el.querySelector('#nN').value.trim(), phone });
              if (phone) localStorage.setItem('mq_phone', phone);
              toast('تم الحفظ');
              s.close();
            } catch (err) { toastErr(err); }
          });
        };
      };
    }
  }

  // تحديث حالة تأكيد البريد لو رجع من الرابط
  if (auth.currentUser && !auth.currentUser.emailVerified) {
    await auth.currentUser.reload().catch(() => {});
    if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
  }
  await draw();
  return subscribe((s, p) => { if ('profile' in p || 'currency' in p || 'user' in p || 'isStaff' in p || 'settings' in p) draw(); });
}
