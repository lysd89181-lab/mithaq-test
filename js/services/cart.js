// السلة (محفوظة في الجهاز) — الأسعار النهائية يحسبها السيرفر دائماً
import { state, set } from '../core/state.js';
import { product } from './catalog.js';
import { pricing, money3 } from '../core/utils.js';

const key = (pid, data) => `${pid}::${data || ''}`;

export function addToCart(p, qty, data = '') {
  const pr = pricing(p);
  const cart = [...state.cart];
  const k = key(p.id, data);
  const found = cart.find((i) => key(i.productId, i.data) === k);
  if (found && !pr.qtyMode) found.qty = Math.min(found.qty + qty, pr.qtyMax);
  else if (found) found.qty = Math.min(Math.max(qty, pr.qtyMin), pr.qtyMax);
  else cart.push({ productId: p.id, qty, data });
  set({ cart });
}

export function setQty(index, qty) {
  const cart = [...state.cart];
  if (!cart[index]) return;
  cart[index] = { ...cart[index], qty };
  set({ cart });
}

export function removeAt(index) {
  set({ cart: state.cart.filter((_, i) => i !== index) });
}

export const clearCart = () => set({ cart: [] });

// يجيب بيانات المنتجات لعرض السلة ويشيل المنتجات المحذوفة
export async function resolveCart() {
  const rows = await Promise.all(state.cart.map(async (i) => ({ ...i, product: await product(i.productId).catch(() => null) })));
  const valid = rows.filter((r) => r.product && r.product.active !== false);
  if (valid.length !== rows.length) set({ cart: valid.map(({ productId, qty, data }) => ({ productId, qty, data })) });
  return valid.map((r) => {
    const pr = pricing(r.product);
    const qty = Math.min(Math.max(r.qty, pr.qtyMin), pr.qtyMax);
    return { ...r, qty, pr, total: money3(pr.unit * qty) };
  });
}
