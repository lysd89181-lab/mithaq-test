// أدوات مشتركة
import { IMAGE_BASE } from './config.js';

// تنظيف أي نص قبل وضعه في HTML (يمنع XSS)
export function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// قالب HTML آمن: كل القيم تتنظف تلقائياً إلا اللي ملفوفة بـ raw()
const RAW = Symbol('raw');
export const raw = (html) => ({ [RAW]: true, html: String(html ?? '') });
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v && v[RAW]) out += v.html;
      else if (Array.isArray(v)) out += v.map((x) => (x && x[RAW] ? x.html : esc(x))).join('');
      else if (v === false || v === null || v === undefined) out += '';
      else out += esc(v);
    }
  });
  return raw(out);
}

// تنظيف HTML يكتبه المدير (صفحات من نحن والأسئلة) — يسمح بوسوم بسيطة فقط
const ALLOWED = new Set(['P', 'B', 'STRONG', 'I', 'EM', 'BR', 'UL', 'OL', 'LI', 'A', 'H3', 'H4', 'SPAN', 'SMALL']);
export function sanitizeHtml(input) {
  const doc = new DOMParser().parseFromString(`<div>${input || ''}</div>`, 'text/html');
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 1) {
        if (!ALLOWED.has(n.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(n.tagName)) { n.remove(); return; }
          walk(n);
          n.replaceWith(...n.childNodes);
          return;
        }
        [...n.attributes].forEach((a) => {
          const ok = n.tagName === 'A' && a.name === 'href' && /^(https?:|tel:|mailto:|#)/i.test(a.value.trim());
          if (!ok) n.removeAttribute(a.name);
        });
        if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
        walk(n);
      }
    });
  };
  const root = doc.body.firstChild;
  walk(root);
  return root.innerHTML;
}

export function imgUrl(img) {
  if (!img) return '';
  const s = String(img).trim();
  if (/^(https?:|data:image\/)/i.test(s)) return s;
  return IMAGE_BASE.replace(/\/?$/, '/') + s.replace(/^\/+/, '');
}

export const money3 = (n) => (Math.round((Number(n) || 0) * 1000) / 1000);

export function fmtDate(ts, withTime = true) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar-LY', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export function timeAgo(ts) {
  const d = ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'الآن';
  if (s < 3600) return `قبل ${Math.floor(s / 60)} د`;
  if (s < 86400) return `قبل ${Math.floor(s / 3600)} س`;
  return fmtDate(ts, false);
}

export function uid(len = 20) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => abc[b % abc.length]).join('');
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export const STATUS = {
  pending: { label: 'قيد التنفيذ', cls: 'wait' },
  completed: { label: 'مكتمل', cls: 'ok' },
  canceled: { label: 'ملغي ومسترجع', cls: 'bad' },
  refunded: { label: 'مسترجع', cls: 'bad' },
  approved: { label: 'مقبول', cls: 'ok' },
  rejected: { label: 'مرفوض', cls: 'bad' },
};
export const statusOf = (s) => STATUS[s] || { label: s || '—', cls: 'neutral' };

// سعر المنتج (نفس منطق السيرفر)
export function pricing(p) {
  const base = Number(p.priceLYD ?? p.price) || 0;
  const discount = Math.min(Math.max(Number(p.discount) || 0, 0), 99);
  const final = discount > 0 ? base - (base * discount) / 100 : base;
  const qtyMode = p.enableQuantity === true;
  const qtyMin = qtyMode ? Math.max(1, Math.floor(Number(p.qtyMin) || 1)) : 1;
  const qtyMax = qtyMode ? Math.max(qtyMin, Math.floor(Number(p.qtyMax) || 100)) : 10;
  return { base, final, discount, qtyMode, qtyMin, qtyMax, unit: qtyMode ? final / qtyMin : final };
}
