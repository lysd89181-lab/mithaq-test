// حالة التطبيق العامة (المستخدم، الإعدادات، السلة، العملة) مع اشتراك بسيط
const listeners = new Set();
const saved = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* وضع خاص */ } };

export const state = {
  authReady: false,
  user: null,        // Firebase user
  profile: null,     // users/{uid}
  isStaff: false,
  settings: {},      // app/settings
  categories: null,
  cart: saved('mq_cart', []),          // [{productId, qty, data}]
  currency: saved('mq_currency', 'LYD'),
  lastSeenNotif: saved('mq_notif_seen', 0),
  unread: 0,
};

export function set(patch) {
  Object.assign(state, patch);
  if ('cart' in patch) save('mq_cart', state.cart);
  if ('currency' in patch) save('mq_currency', state.currency);
  if ('lastSeenNotif' in patch) save('mq_notif_seen', state.lastSeenNotif);
  listeners.forEach((fn) => { try { fn(state, patch); } catch (e) { console.error(e); } });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const usdRate = () => Number(state.settings.usd_rate || state.settings.binance_rate) || 11;

// تنسيق السعر بعملة العرض المختارة (الحساب دائماً بالدينار)
export function fmt(lyd, { unit = true } = {}) {
  const v = Number(lyd) || 0;
  if (state.currency === 'USD') {
    const s = (v / usdRate()).toFixed(2);
    return unit ? `$${s}` : s;
  }
  const s = v.toFixed(3).replace(/\.?0+$/, '');
  return unit ? `${s} د.ل` : s;
}
export const cartCount = () => state.cart.length;

// انتظار معرفة حالة الدخول
export const whenAuth = () => (state.authReady ? Promise.resolve() : new Promise((r) => {
  const off = subscribe((s) => { if (s.authReady) { off(); r(); } });
}));
