// موجّه الصفحات بالـ hash (#/...) — يشتغل على GitHub Pages بدون إعدادات سيرفر
const routes = [];
let cleanup = null;
let view;
let onChange = () => {};

export function route(pattern, loader, opts = {}) {
  routes.push({ pattern, loader, ...opts });
}

export function currentPath() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', params: new URLSearchParams(qs || '') };
}

export const go = (path) => { location.hash = path; };
export const back = (fallback = '/') => { if (history.length > 1) history.back(); else go(fallback); };

async function render() {
  const { path, params } = currentPath();
  let match = null;
  let r;
  for (r of routes) { match = path.match(r.pattern); if (match) break; }
  if (!match) { r = routes.find((x) => x.notFound); match = []; }
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  onChange(path, r);
  if (r.guard) {
    const redirect = await r.guard();
    if (redirect) { location.replace(redirect); return; }
  }
  view.setAttribute('aria-busy', 'true');
  try {
    const mod = await r.loader();
    const token = Symbol('render');
    render.token = token;
    const result = await mod.default(view, { match: match.slice(1).map(decodeURIComponent), params, path });
    if (render.token !== token) { if (typeof result === 'function') result(); return; }
    cleanup = typeof result === 'function' ? result : null;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="page"><div class="empty"><h3>تعذر تحميل الصفحة</h3><p>${String(e.message || e).replace(/</g, '&lt;')}</p><button class="btn btn-ghost" onclick="location.reload()">إعادة المحاولة</button></div></div>`;
  } finally {
    view.removeAttribute('aria-busy');
  }
}

export function startRouter(el, changed) {
  view = el;
  onChange = changed || onChange;
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });
  render();
}

export const refresh = () => render();
