// أدوات مشتركة لصفحات لوحة التحكم
import { db, collection, addDoc, serverTimestamp } from '../../js/core/firebase.js';
import { html, raw, statusOf, imgUrl } from '../../js/core/utils.js';
import { me } from './session.js';

export const lyd = (n) => `${(Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} د.ل`;
export const badge = (s) => { const x = statusOf(s); return html`<span class="badge ${x.cls}">${x.label}</span>`; };
export const tsMs = (t) => t?.toMillis?.() || (t?.seconds ? t.seconds * 1000 : 0);

// تسجيل عملية في سجل العمليات (للتعديلات اللي تتم من المتصفح)
export function audit(type, data = {}) {
  return addDoc(collection(db, 'audit_logs'), { by: me.uid, byName: me.name, type, at: serverTimestamp(), ...data }).catch(() => {});
}

export function prodCell(name, img, sub = '') {
  return html`<div class="cell-prod">${img ? html`<img src="${imgUrl(img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}<div style="min-width:0"><div class="strong">${name}</div>${sub ? html`<div class="hint">${sub}</div>` : ''}</div></div>`;
}

// قراءة نموذج إلى كائن حسب name
export function formData(form) {
  const o = {};
  form.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? null : Number(el.value);
    else o[el.name] = el.value.trim();
  });
  return o;
}

export const sw = (name, checked, label) => html`<label class="toggle-row"><span>${label}</span><span class="switch"><input type="checkbox" name="${name}" ${checked ? raw('checked') : ''}><span></span></span></label>`;
export const fld = (label, inner, hint = '') => html`<div class="field"><label>${label}</label>${raw(inner.html || inner)}${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;

export function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="full" style="text-align:center;color:var(--fog);padding:32px">${text}</td></tr>`;
}

// تصدير CSV (يفتح في Excel)
export function downloadCsv(name, rows) {
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
