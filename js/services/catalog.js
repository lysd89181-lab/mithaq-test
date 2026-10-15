// الكتالوج: الإعدادات، الأقسام، المنتجات (مع تخزين مؤقت في الذاكرة)
import { db, doc, getDoc, getDocs, collection, query, where, orderBy, onSnapshot } from '../core/firebase.js';
import { state, set } from '../core/state.js';

const cache = { byCat: new Map(), byId: new Map(), all: null, slides: null };

export function watchSettings() {
  return onSnapshot(doc(db, 'app', 'settings'), (snap) => {
    set({ settings: snap.exists() ? snap.data() : {}, settingsLoaded: true });
  }, () => set({ settings: {}, settingsLoaded: true }));
}

export async function categories() {
  if (state.categories) return state.categories;
  const snap = await getDocs(query(collection(db, 'categories'), orderBy('order')));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.active !== false);
  set({ categories: list });
  return list;
}

export async function category(id) {
  const list = await categories();
  return list.find((c) => c.id === id) || null;
}

const keep = (d) => { const p = { id: d.id, ...d.data() }; cache.byId.set(p.id, p); return p; };
const byPrice = (a, b) => (Number(a.priceLYD ?? a.price) || 0) - (Number(b.priceLYD ?? b.price) || 0);

export async function productsOf(catId) {
  if (cache.byCat.has(catId)) return cache.byCat.get(catId);
  const snap = await getDocs(query(collection(db, 'products'), where('categoryId', '==', catId), where('active', '==', true)));
  const list = snap.docs.map(keep).sort(byPrice);
  cache.byCat.set(catId, list);
  return list;
}

export async function product(id) {
  if (cache.byId.has(id)) return cache.byId.get(id);
  const d = await getDoc(doc(db, 'products', id));
  if (!d.exists()) return null;
  return keep(d);
}

export async function allProducts() {
  if (cache.all) return cache.all;
  const snap = await getDocs(query(collection(db, 'products'), where('active', '==', true)));
  cache.all = snap.docs.map(keep);
  return cache.all;
}

export async function bestSellers(n = 8) {
  const all = await allProducts();
  return [...all].sort((a, b) => (Number(b.sales) || 0) - (Number(a.sales) || 0)).slice(0, n);
}

export async function search(term) {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const [all, cats] = await Promise.all([allProducts(), categories()]);
  const catNames = new Map(cats.map((c) => [c.id, (c.name || '').toLowerCase()]));
  return all.filter((p) => (p.name || '').toLowerCase().includes(t) || (catNames.get(p.categoryId) || '').includes(t)
    || (p.description || '').toLowerCase().includes(t)).sort(byPrice);
}

export async function heroSlides() {
  if (cache.slides) return cache.slides;
  try {
    const d = await getDoc(doc(db, 'settings', 'hero_slides'));
    cache.slides = (d.exists() ? d.data().slides || [] : []).filter((s) => s.active !== false && s.image);
  } catch {
    cache.slides = [];
  }
  return cache.slides;
}
