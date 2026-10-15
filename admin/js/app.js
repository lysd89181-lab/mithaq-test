// لوحة التحكم: بوابة الدخول + الهيكل + التنقل حسب الصلاحيات
import {
  auth, db, doc, getDoc, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence,
  collection, query, where, onSnapshot, limit,
} from '../../js/core/firebase.js';
import { html } from '../../js/core/utils.js';
import { icon, iconStr } from '../../js/core/icons.js';
import { toast, toastErr, sheet, withLoading } from '../../js/core/ui.js';
import { route, startRouter, currentPath } from '../../js/core/router.js';
import { registerSW, enablePush, pushState, listenForeground } from '../../js/services/push.js';
import { me, setMe, can, counts, setCounts } from './session.js';

const root = document.getElementById('root');

const MENU = [
  { group: 'العمليات' },
  { path: '/', label: 'الرئيسية', icon: 'pie', perm: null },
  { path: '/orders', label: 'الطلبات', icon: 'cart', perm: 'orders', count: 'orders' },
  { path: '/deposits', label: 'الإيداعات', icon: 'wallet', perm: 'deposits', count: 'deposits' },
  { group: 'المتجر' },
  { path: '/catalog', label: 'الأقسام والمنتجات', icon: 'layers', perm: 'products' },
  { path: '/stock', label: 'المخزون', icon: 'box', perm: 'stock' },
  { path: '/coupons', label: 'الكوبونات', icon: 'percent', perm: 'coupons' },
  { group: 'الناس' },
  { path: '/users', label: 'المستخدمين', icon: 'users', perm: 'users' },
  { path: '/staff', label: 'الموظفين والصلاحيات', icon: 'key', perm: 'admin' },
  { path: '/notify', label: 'الإشعارات', icon: 'bell', perm: 'notify' },
  { group: 'الإدارة' },
  { path: '/reports', label: 'التقارير', icon: 'chart', perm: 'reports' },
  { path: '/settings', label: 'إعدادات المنصة', icon: 'settings', perm: 'settings' },
  { path: '/audit', label: 'سجل العمليات', icon: 'history', perm: 'audit' },
];
const MOBILE = ['/', '/orders', '/deposits', '/catalog'];

const guard = (perm) => async () => (perm && !can(perm) ? '#/' : null);
route(/^\/$/, () => import('./pages/dashboard.js'));
route(/^\/orders$/, () => import('./pages/orders.js'), { guard: guard('orders') });
route(/^\/deposits$/, () => import('./pages/deposits.js'), { guard: guard('deposits') });
route(/^\/catalog$/, () => import('./pages/catalog.js'), { guard: guard('products') });
route(/^\/stock$/, () => import('./pages/stock.js'), { guard: guard('stock') });
route(/^\/coupons$/, () => import('./pages/coupons.js'), { guard: guard('coupons') });
route(/^\/users$/, () => import('./pages/users.js'), { guard: guard('users') });
route(/^\/staff$/, () => import('./pages/staff.js'), { guard: guard('admin') });
route(/^\/notify$/, () => import('./pages/notify.js'), { guard: guard('notify') });
route(/^\/reports$/, () => import('./pages/reports.js'), { guard: guard('reports') });
route(/^\/settings$/, () => import('./pages/settings.js'), { guard: guard('settings') });
route(/^\/audit$/, () => import('./pages/audit.js'), { guard: guard('audit') });
route(/^\/404$/, () => import('./pages/dashboard.js'), { notFound: true });

// ===== بوابة الدخول =====
function gate(msg = '') {
  root.innerHTML = html`<div class="gate"><form class="gate-card" id="g" novalidate>
    <img src="../assets/logo.png" alt="ميثاق">
    <h1>مرحبا بك في لوحة التحكم</h1>
    <div class="field"><label for="ge">البريد الإلكتروني</label><div class="input-wrap">${icon('mail')}<input id="ge" class="input ltr" dir="ltr" type="email" autocomplete="username" required></div></div>
    <div class="field"><label for="gp">كلمة المرور</label><div class="input-wrap">${icon('lock')}<input id="gp" class="input ltr" dir="ltr" type="password" autocomplete="current-password" required></div></div>
    <p class="hint err" ${msg ? '' : 'hidden'}>${msg}</p>
    <button class="btn btn-primary btn-block"><span class="label">تسجيل الدخول</span><span class="spin"></span></button>
    <a href="../" class="hint" style="text-align:center">رجوع للمتجر</a>
  </form></div>`.html;
  const f = root.querySelector('#g');
  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading(f.querySelector('button'), async () => {
      try {
        // الجلسة تنتهي بقفل المتصفح (أأمن للإدارة)
        await setPersistence(auth, browserSessionPersistence);
        await signInWithEmailAndPassword(auth, f.querySelector('#ge').value.trim(), f.querySelector('#gp').value);
      } catch (err) {
        const h = f.querySelector('.hint.err');
        h.hidden = false;
        h.textContent = err.code === 'auth/too-many-requests' ? 'محاولات كثيرة، استنى شوية' : 'البريد أو كلمة المرور غير صحيحة';
      }
    });
  };
}

// ===== الهيكل =====
function shell() {
  const items = MENU.filter((m) => m.group || !m.perm || can(m.perm));
  const groups = items.filter((m, i) => !m.group || (items[i + 1] && !items[i + 1].group));
  root.innerHTML = html`<div class="adm">
    <aside class="side" aria-label="القائمة">
      <div class="side-brand"><img src="../assets/logo-mark.png" alt=""><div><b>ميثاق</b><small>لوحة التحكم</small></div></div>
      <nav id="sideNav">${groups.map((m) => (m.group ? html`<div class="group">${m.group}</div>` : html`<a href="#${m.path}" data-p="${m.path}">${icon(m.icon)}<span>${m.label}</span>${m.count ? html`<span class="count badge red" data-c="${m.count}" hidden></span>` : ''}</a>`))}</nav>
      <div class="side-foot"><div class="avatar" style="width:38px;height:38px;border-radius:12px;font-size:1rem">${(me.name || 'م').slice(0, 1)}</div>
        <div class="grow"><b style="font-size:var(--fs-sm)">${me.name}</b><div class="hint">${me.role === 'admin' ? 'مدير' : 'موظف'}</div></div>
        <button class="icon-btn" id="out1" aria-label="تسجيل الخروج">${icon('logout')}</button></div>
    </aside>
    <div class="adm-main">
      <header class="topbar"><button class="icon-btn menu-btn" id="menuBtn" aria-label="القائمة">${icon('menu')}</button>
        <h1 id="pageTitle">الرئيسية</h1>
        <button class="icon-btn" id="pushBtn" aria-label="إشعارات الإدارة">${icon('bell')}</button>
        <a href="../" class="icon-btn" aria-label="فتح المتجر" target="_blank">${icon('external')}</a>
        <div class="who"><span>${me.name}</span></div></header>
      <main class="content" id="view"></main>
    </div>
    <nav class="adm-nav" aria-label="التنقل">
      ${MENU.filter((m) => MOBILE.includes(m.path) && (!m.perm || can(m.perm))).map((m) => html`<a href="#${m.path}" data-p="${m.path}">${icon(m.icon)}${m.count ? html`<span class="dot" data-c="${m.count}" hidden></span>` : ''}<span>${m.label.split(' ')[0]}</span></a>`)}
      <button id="moreBtn">${icon('menu')}<span>المزيد</span></button>
    </nav>
  </div>`.html;

  const out = async () => { await signOut(auth); location.reload(); };
  root.querySelector('#out1').onclick = out;
  const openMenu = () => {
    const s = sheet('القائمة', html`<nav class="menu-list">${groups.filter((m) => !m.group).map((m) => html`<a href="#${m.path}" data-close>${icon(m.icon)}<span>${m.label}</span></a>`)}
      <button data-close id="outM" style="color:var(--bad)">${icon('logout')}<span>تسجيل الخروج</span></button></nav>`.html);
    s.el.querySelector('#outM').onclick = out;
  };
  root.querySelector('#moreBtn').onclick = openMenu;
  root.querySelector('#menuBtn').onclick = openMenu;
  root.querySelector('#pushBtn').onclick = async (e) => {
    try {
      await withLoading(e.currentTarget, enablePush);
      toast('تم تفعيل إشعارات الطلبات على هذا الجهاز');
      paintPush();
    } catch (err) { toastErr(err); }
  };
  paintPush();
  startRouter(root.querySelector('#view'), (path) => {
    const m = MENU.find((x) => x.path === path);
    root.querySelector('#pageTitle').textContent = m ? m.label : 'الرئيسية';
    document.title = `${m ? m.label : 'الرئيسية'} | لوحة ميثاق`;
    root.querySelectorAll('[data-p]').forEach((a) => a.classList.toggle('active', a.dataset.p === path));
  });
  watchCounts();
  registerSW().then(() => listenForeground());
}

function paintPush() {
  const b = root.querySelector('#pushBtn');
  if (!b) return;
  const on = pushState() === 'granted' && localStorage.getItem('mq_push_token');
  b.style.color = on ? 'var(--ok)' : '';
  b.title = on ? 'الإشعارات مفعّلة' : 'فعّل إشعارات الطلبات';
}

// عدادات الطلبات والإيداعات المعلقة في القائمة
function watchCounts() {
  const paint = () => {
    root.querySelectorAll('[data-c]').forEach((el) => {
      const n = counts[el.dataset.c] || 0;
      el.hidden = !n;
      el.textContent = n > 99 ? '99+' : n;
    });
  };
  if (can('orders')) onSnapshot(query(collection(db, 'orders'), where('status', '==', 'pending'), limit(200)), (s) => { setCounts({ orders: s.size }); paint(); }, () => {});
  if (can('deposits')) onSnapshot(query(collection(db, 'deposits'), where('status', '==', 'pending'), limit(200)), (s) => { setCounts({ deposits: s.size }); paint(); }, () => {});
}

// ===== الجلسة =====
let started = false;
onAuthStateChanged(auth, async (user) => {
  if (!user) { if (!started) gate(); else location.reload(); return; }
  try {
    const d = await getDoc(doc(db, 'admins', user.uid));
    if (!d.exists()) { await signOut(auth); gate('الحساب هذا ما عندهش صلاحية إدارة'); return; }
    const data = d.data();
    setMe({ uid: user.uid, email: user.email, name: data.name || user.displayName || user.email.split('@')[0], role: data.role === 'admin' ? 'admin' : 'staff', perms: data.perms || {} });
  } catch {
    await signOut(auth);
    gate('تعذر التحقق من الصلاحية');
    return;
  }
  if (!started) { started = true; shell(); }
});
