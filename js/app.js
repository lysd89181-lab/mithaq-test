// نقطة تشغيل المتجر
import { auth, db, onAuthStateChanged, doc, onSnapshot, setDoc, getDoc, collection, query, where, limit, serverTimestamp } from './core/firebase.js';
import { state, set, subscribe, fmt, cartCount, whenAuth } from './core/state.js';
import { route, startRouter, currentPath, go } from './core/router.js';
import { icon, iconStr } from './core/icons.js';
import { esc } from './core/utils.js';
import { watchSettings } from './services/catalog.js';
import { registerSW, refreshPush, listenForeground } from './services/push.js';

// ===== انتظار حالة الدخول =====
export const loginUrl = () => `auth/?next=${encodeURIComponent(location.hash || '#/')}`;
const needAuth = async () => { await whenAuth(); return state.user ? null : loginUrl(); };

// ===== الصفحات =====
route(/^\/$/, () => import('./pages/home.js'));
route(/^\/categories$/, () => import('./pages/categories.js'));
route(/^\/c\/([\w-]+)$/, () => import('./pages/category.js'));
route(/^\/p\/([\w-]+)$/, () => import('./pages/product.js'));
route(/^\/search$/, () => import('./pages/search.js'));
route(/^\/cart$/, () => import('./pages/cart.js'));
route(/^\/wallet$/, () => import('./pages/wallet.js'), { guard: needAuth });
route(/^\/orders$/, () => import('./pages/orders.js'), { guard: needAuth });
route(/^\/notifications$/, () => import('./pages/notifications.js'), { guard: needAuth });
route(/^\/account$/, () => import('./pages/account.js'));
route(/^\/support$/, () => import('./pages/support.js'));
route(/^\/page\/([\w-]+)$/, () => import('./pages/info.js'));
route(/^\/404$/, () => import('./pages/notfound.js'), { notFound: true });

// ===== الهيدر والتنقل =====
const NAV = [
  { path: '/', label: 'الرئيسية', icon: 'home' },
  { path: '/categories', label: 'الأقسام', icon: 'grid' },
  { path: '/cart', label: 'السلة', icon: 'cart', badge: () => cartCount() },
  { path: '/orders', label: 'طلباتي', icon: 'receipt' },
  { path: '/account', label: 'حسابي', icon: 'user' },
];

function activeFor(path) {
  if (path === '/') return '/';
  if (path.startsWith('/c/') || path.startsWith('/p/') || path === '/search') return '/categories';
  if (path === '/wallet' || path === '/notifications' || path === '/support' || path.startsWith('/page/')) return '/account';
  return path;
}

function renderHeader() {
  const s = state.settings;
  const brand = s.brand_name && s.brand_name !== 'iQ Store' ? s.brand_name : 'ميثاق';
  const act = activeFor(currentPath().path);
  const logged = !!state.user;
  document.getElementById('header').innerHTML = `
    <div class="header-inner">
      <a href="#/" class="brand" aria-label="${esc(brand)} - الرئيسية">
        <img class="mark" src="assets/logo-mark.png" alt="" width="42" height="34"><span class="word">${esc(brand)}</span>
      </a>
      <nav class="desk-nav" aria-label="الأقسام">
        ${NAV.filter((n) => n.path !== '/cart').map((n) => `<a href="#${n.path}" class="${act === n.path ? 'active' : ''}">${esc(n.label)}</a>`).join('')}
      </nav>
      <form class="header-search" role="search" id="hSearch">
        <div class="input-wrap">${iconStr('search')}<input class="input" name="q" placeholder="ابحث عن بطاقة أو اشتراك" aria-label="بحث" style="min-height:42px;background:var(--ink-2)"></div>
      </form>
      <div class="header-actions">
        ${logged ? `<a href="#/wallet" class="wallet-pill" aria-label="رصيدي"><span class="num">${esc(fmt(state.profile?.balance || 0))}</span><span class="plus">${iconStr('plus', 'sm')}</span></a>
          <a href="#/notifications" class="icon-btn" aria-label="الإشعارات">${iconStr('bell')}${state.unread ? `<span class="dot">${state.unread > 9 ? '9+' : state.unread}</span>` : ''}</a>`
        : `<a href="${loginUrl()}" class="btn btn-primary btn-sm">تسجيل الدخول</a>`}
        <a href="#/cart" class="icon-btn desk-only" aria-label="السلة">${iconStr('cart')}${cartCount() ? `<span class="dot">${cartCount()}</span>` : ''}</a>
      </div>
    </div>`;
  document.getElementById('hSearch').onsubmit = (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) go(`/search?q=${encodeURIComponent(q)}`);
  };
}

function renderNav() {
  const act = activeFor(currentPath().path);
  document.getElementById('bottomNav').innerHTML = NAV.map((n) => {
    const b = n.badge ? n.badge() : 0;
    return `<a href="#${n.path}" class="${act === n.path ? 'active' : ''}" ${act === n.path ? 'aria-current="page"' : ''}>
      ${iconStr(n.icon)}${b ? `<span class="dot">${b}</span>` : ''}<span>${esc(n.label)}</span></a>`;
  }).join('');
}

function renderBanner() {
  const b = state.settings.emergency_banner;
  document.getElementById('banner').innerHTML = b && b.active && b.message
    ? `<div class="banner danger" role="alert">${iconStr('alert', 'sm')}<span>${esc(b.message)}</span></div>` : '';
}

const shell = () => { renderHeader(); renderNav(); };
subscribe((s, patch) => {
  if ('settings' in patch) { renderBanner(); renderHeader(); }
  if ('cart' in patch || 'profile' in patch || 'user' in patch || 'unread' in patch || 'currency' in patch) shell();
});

// ===== الجلسة =====
let unsubProfile = null;
let unsubNotif = null;
onAuthStateChanged(auth, async (user) => {
  unsubProfile && unsubProfile();
  unsubNotif && unsubNotif();
  set({ user, profile: null, isStaff: false, unread: 0 });
  if (user) {
    const ref = doc(db, 'users', user.uid);
    unsubProfile = onSnapshot(ref, async (snap) => {
      if (!snap.exists()) {
        // حساب قديم بدون ملف: ننشئه برصيد صفر (القواعد تمنع أي رصيد غير صفر)
        await setDoc(ref, { uid: user.uid, name: user.displayName || user.email.split('@')[0], email: user.email, balance: 0, isActive: true, createdAt: serverTimestamp() }).catch(() => {});
        return;
      }
      set({ profile: { id: snap.id, ...snap.data() } });
    });
    getDoc(doc(db, 'admins', user.uid)).then((d) => set({ isStaff: d.exists() })).catch(() => {});
    unsubNotif = onSnapshot(query(collection(db, 'notifications'), where('userId', 'in', [user.uid, 'all']), limit(30)), (snap) => {
      const seen = state.lastSeenNotif || 0;
      const unread = snap.docs.filter((d) => (d.data().createdAt?.toMillis?.() || 0) > seen).length;
      set({ unread });
    }, () => {});
    refreshPush();
  }
  if (!state.authReady) set({ authReady: true });
});

// ===== التشغيل =====
watchSettings();
shell();
renderBanner();
// نستنى الإعدادات أول مرة (بحد أقصى ثانيتين ونص) باش الصفحات تتعرض كاملة
const settingsFirst = new Promise((r) => {
  if (state.settingsLoaded) return r();
  const off = subscribe((st) => { if (st.settingsLoaded) { off(); r(); } });
  setTimeout(r, 2500);
});
settingsFirst.then(() => startRouter(document.getElementById('view'), () => shell()));
registerSW().then(() => listenForeground());
