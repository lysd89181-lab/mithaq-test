// عناصر الواجهة: تنبيهات، نوافذ منبثقة، تأكيد
import { iconStr } from './icons.js';
import { esc } from './utils.js';

let toastHost;
export function toast(message, type = 'ok', ms = 3200) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${iconStr(type === 'err' ? 'alert' : type === 'info' ? 'info' : 'check')}<span>${esc(message)}</span>`;
  toastHost.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}
export const toastErr = (e) => toast(e?.message || String(e), 'err', 4500);

// نافذة منبثقة من الأسفل. content: نص HTML. ترجع {el, close}
export function sheet(title, content, { onClose, wide } = {}) {
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${wide ? 'style="width:min(760px,100%)"' : ''}>
    <div class="sheet-grip"></div>
    <div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="إغلاق">${iconStr('x')}</button></div>
    <div class="sheet-body">${content}</div></div>`;
  const prevFocus = document.activeElement;
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    onClose && onClose();
    prevFocus && prevFocus.focus && prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';
  const first = back.querySelector('input, select, textarea, button:not([data-close])');
  setTimeout(() => (first || back.querySelector('[data-close]')).focus({ preventScroll: true }), 50);
  return { el: back.querySelector('.sheet'), close };
}

export function confirmBox(title, message, { ok = 'تأكيد', danger = false, input = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(title, `
      <p class="muted" style="margin-bottom:16px">${esc(message)}</p>
      ${input ? `<div class="field" style="margin-bottom:16px"><label for="cb-in">${esc(input.label)}</label><input id="cb-in" class="input" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" ${input.type ? `type="${input.type}"` : ''}></div>` : ''}
      <div class="row"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" style="flex:1" data-ok>${esc(ok)}</button>
      <button class="btn btn-ghost" style="flex:1" data-close>رجوع</button></div>`, {
      onClose: () => { if (!done) resolve(null); },
    });
    s.el.querySelector('[data-ok]').onclick = () => {
      done = true;
      const v = input ? s.el.querySelector('#cb-in').value : true;
      s.close();
      resolve(v === '' && input ? '' : v);
    };
  });
}

// زر بحالة تحميل أثناء تنفيذ عملية
export async function withLoading(btn, fn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}
