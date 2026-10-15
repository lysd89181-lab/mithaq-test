// الدخول، إنشاء حساب، استعادة كلمة المرور، وتأكيد البريد
import {
  auth, db, doc, setDoc, serverTimestamp, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, updateProfile, signOut,
} from '../js/core/firebase.js';
import { html } from '../js/core/utils.js';
import { icon } from '../js/core/icons.js';
import { toast, withLoading } from '../js/core/ui.js';

const view = document.getElementById('authView');
const params = new URLSearchParams(location.search);
// الرجوع لنفس الصفحة بعد الدخول (hash داخل المتجر فقط)
const nextHash = /^#\/[\w\/?=&%-]*$/.test(params.get('next') || '') ? params.get('next') : '#/';
const storeUrl = new URL('../', location.href).href;
const goNext = () => location.replace(storeUrl + nextHash);
const verifyReturn = () => ({ url: `${storeUrl}#/account` });

const ERR = {
  'auth/invalid-credential': 'البريد أو كلمة المرور غير صحيحة',
  'auth/wrong-password': 'البريد أو كلمة المرور غير صحيحة',
  'auth/user-not-found': 'البريد أو كلمة المرور غير صحيحة',
  'auth/invalid-email': 'صيغة البريد غير صحيحة',
  'auth/email-already-in-use': 'البريد هذا عنده حساب. سجل دخولك أو استرجع كلمة المرور',
  'auth/weak-password': 'كلمة المرور ضعيفة، خليها 8 أحرف فيها حروف وأرقام',
  'auth/too-many-requests': 'محاولات كثيرة. استنى شوية وجرب مرة أخرى',
  'auth/user-disabled': 'الحساب هذا موقوف. تواصل مع الدعم',
  'auth/network-request-failed': 'تأكد من الإنترنت وجرب مرة أخرى',
};
const errMsg = (e) => ERR[e.code] || 'صار خطأ، جرب مرة أخرى';
const showErr = (form, msg) => { const h = form.querySelector('.hint.err'); h.textContent = msg; h.hidden = false; };

const pwField = (id, label, auto) => html`<div class="field"><label for="${id}">${label}</label>
  <div class="input-wrap">${icon('lock')}<input id="${id}" class="input ltr" dir="ltr" type="password" autocomplete="${auto}" required minlength="8">
  <button type="button" class="icon-btn trail" data-eye="${id}" aria-label="إظهار كلمة المرور">${icon('eye', 'sm')}</button></div></div>`;
const mailField = (val = '') => html`<div class="field"><label for="em">البريد الإلكتروني</label>
  <div class="input-wrap">${icon('mail')}<input id="em" class="input ltr" dir="ltr" type="email" autocomplete="email" required value="${val}"></div></div>`;

function bindEyes() {
  view.querySelectorAll('[data-eye]').forEach((b) => {
    b.onclick = () => { const i = document.getElementById(b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; };
  });
}

function login() {
  view.innerHTML = html`<h1>أهلاً بيك</h1><p class="lead">سجل دخولك باش تكمل</p>
    <form id="f" novalidate>
      ${mailField(params.get('email') || '')}
      ${pwField('pw', 'كلمة المرور', 'current-password')}
      <a href="#" class="link" id="toReset">نسيت كلمة المرور؟</a>
      <p class="hint err" hidden></p>
      <button class="btn btn-primary btn-block"><span class="label">تسجيل الدخول</span><span class="spin"></span></button>
    </form>
    <p class="switch-mode">ما عندكش حساب؟ <a href="#" id="toReg">أنشئ حساب جديد</a></p>`.html;
  bindEyes();
  view.querySelector('#toReg').onclick = (e) => { e.preventDefault(); register(); };
  view.querySelector('#toReset').onclick = (e) => { e.preventDefault(); reset(view.querySelector('#em').value); };
  const f = view.querySelector('#f');
  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading(f.querySelector('button.btn'), async () => {
      try {
        await signInWithEmailAndPassword(auth, f.querySelector('#em').value.trim(), f.querySelector('#pw').value);
        goNext();
      } catch (err) { showErr(f, errMsg(err)); }
    });
  };
}

function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 12) s++;
  return pw ? Math.max(s, 1) : 0;
}

function register() {
  view.innerHTML = html`<h1>حساب جديد</h1><p class="lead">دقيقة وحدة وتبدأ تشتري</p>
    <form id="f" novalidate>
      <div class="field"><label for="nm">الاسم</label><div class="input-wrap">${icon('user')}<input id="nm" class="input" autocomplete="name" required minlength="3" maxlength="60"></div></div>
      ${mailField()}
      <div class="field"><label for="ph">رقم الهاتف (واتساب)</label><div class="input-wrap">${icon('phone')}<input id="ph" class="input ltr" dir="ltr" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="09XXXXXXXX"></div></div>
      ${pwField('pw', 'كلمة المرور', 'new-password')}
      <div class="meter" id="meter"><i></i><i></i><i></i><i></i></div>
      <span class="hint">8 أحرف على الأقل، والأفضل فيها حروف كبيرة وأرقام.</span>
      ${pwField('pw2', 'تأكيد كلمة المرور', 'new-password')}
      <p class="hint err" hidden></p>
      <button class="btn btn-primary btn-block"><span class="label">إنشاء الحساب</span><span class="spin"></span></button>
    </form>
    <p class="switch-mode">عندك حساب؟ <a href="#" id="toLogin">سجل دخولك</a></p>`.html;
  bindEyes();
  view.querySelector('#toLogin').onclick = (e) => { e.preventDefault(); login(); };
  view.querySelector('#pw').oninput = (e) => { view.querySelector('#meter').className = `meter s${strength(e.target.value)}`; };
  const f = view.querySelector('#f');
  f.onsubmit = (e) => {
    e.preventDefault();
    const name = f.querySelector('#nm').value.trim();
    const email = f.querySelector('#em').value.trim();
    const phone = f.querySelector('#ph').value.trim();
    const pw = f.querySelector('#pw').value;
    if (name.length < 3) return showErr(f, 'اكتب اسمك (3 أحرف على الأقل)');
    if (!/^\S+@\S+\.\S+$/.test(email)) return showErr(f, 'صيغة البريد غير صحيحة');
    if (pw.length < 8) return showErr(f, 'كلمة المرور لازم 8 أحرف على الأقل');
    if (pw !== f.querySelector('#pw2').value) return showErr(f, 'كلمتا المرور مش متطابقتين');
    withLoading(f.querySelector('button.btn'), async () => {
      try {
        const { user } = await createUserWithEmailAndPassword(auth, email, pw);
        await updateProfile(user, { displayName: name });
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid, name, username: name.toLowerCase().replace(/\s+/g, '_'), email, phone,
          balance: 0, isActive: true, createdAt: serverTimestamp(), lastLogin: serverTimestamp(),
        });
        if (phone) localStorage.setItem('mq_phone', phone);
        await sendEmailVerification(user, verifyReturn()).catch(() => {});
        sent(email);
      } catch (err) { showErr(f, errMsg(err)); }
    });
  };
}

function sent(email) {
  view.innerHTML = html`<div class="sent">
    <span class="ring">${icon('mail')}</span>
    <h1>أكّد بريدك</h1>
    <p class="muted">بعثنا رابط تأكيد على <b class="ltr">${email}</b>. افتحه من بريدك (شوف مجلد الرسائل غير المرغوبة كمان)، وبعدها ارجع هنا.</p>
    <button class="btn btn-primary btn-block" id="done"><span class="label">أكدت بريدي</span><span class="spin"></span></button>
    <button class="btn btn-ghost btn-block" id="again">إرسال الرابط من جديد</button>
    <a href="#" class="link" id="later" style="justify-self:center">أكمل التصفح، نأكد بعدين</a>
  </div>`.html;
  view.querySelector('#done').onclick = (e) => withLoading(e.currentTarget, async () => {
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) { await auth.currentUser.getIdToken(true); toast('تم تأكيد بريدك'); goNext(); } else toast('البريد مازال غير مؤكد. افتح الرابط اللي وصلك', 'err');
  });
  view.querySelector('#again').onclick = (e) => withLoading(e.currentTarget, async () => {
    try { await sendEmailVerification(auth.currentUser, verifyReturn()); toast('تم إرسال الرابط من جديد'); } catch (err) { toast(errMsg(err), 'err'); }
  });
  view.querySelector('#later').onclick = (e) => { e.preventDefault(); goNext(); };
}

function reset(prefill = '') {
  view.innerHTML = html`<h1>استرجاع كلمة المرور</h1><p class="lead">نبعثولك رابط تغيّر منه كلمة المرور</p>
    <form id="f" novalidate>${mailField(prefill)}<p class="hint err" hidden></p>
      <button class="btn btn-primary btn-block"><span class="label">إرسال الرابط</span><span class="spin"></span></button></form>
    <p class="switch-mode"><a href="#" id="toLogin">رجوع لتسجيل الدخول</a></p>`.html;
  view.querySelector('#toLogin').onclick = (e) => { e.preventDefault(); login(); };
  const f = view.querySelector('#f');
  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading(f.querySelector('button.btn'), async () => {
      try {
        await sendPasswordResetEmail(auth, f.querySelector('#em').value.trim(), { url: `${storeUrl}auth/` });
        // نفس الرسالة دايماً حتى لو البريد مش مسجل (ما نكشفوش الحسابات)
        view.innerHTML = html`<div class="sent"><span class="ring">${icon('mail')}</span><h1>شوف بريدك</h1>
          <p class="muted">لو البريد مسجل عندنا، بيوصلك رابط تغيير كلمة المرور خلال دقائق.</p>
          <a href="#" class="btn btn-ghost btn-block" id="back">رجوع لتسجيل الدخول</a></div>`.html;
        view.querySelector('#back').onclick = (ev) => { ev.preventDefault(); login(); };
      } catch (err) {
        if (err.code === 'auth/user-not-found') { view.querySelector('#f').innerHTML = '<p class="muted">لو البريد مسجل عندنا، بيوصلك الرابط.</p>'; return; }
        showErr(f, errMsg(err));
      }
    });
  };
}

// لو داخل من قبل: نرجعوه للمتجر، إلا لو حسابه غير مؤكد نوريه شاشة التأكيد
let first = true;
onAuthStateChanged(auth, (user) => {
  if (!first) return;
  first = false;
  if (user && params.get('mode') !== 'register') goNext();
  else if (params.get('mode') === 'register') { if (user) signOut(auth); register(); } else login();
});
