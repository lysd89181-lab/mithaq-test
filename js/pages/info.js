// صفحات المعلومات (من نحن، الأسئلة الشائعة...) من إعدادات المنصة
import { html, raw, sanitizeHtml } from '../core/utils.js';
import { state, whenAuth } from '../core/state.js';
import { pageHead, empty, siteFooter } from '../components/blocks.js';

export default async function page(el, { match: [id] }) {
  await whenAuth();
  const sec = (state.settings.trust_sections || []).find((t) => t.id === id && t.active !== false);
  el.innerHTML = sec
    ? html`<div class="page" style="max-width:760px">${raw(pageHead(sec.title, '/account'))}<article class="panel rich">${raw(sanitizeHtml(sec.content))}</article>${raw(siteFooter())}</div>`.html
    : `<div class="page">${empty('info', 'الصفحة غير موجودة')}</div>`;
}
