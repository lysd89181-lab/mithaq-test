// الدعم الفني
import { html, raw } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { state } from '../core/state.js';
import { pageHead } from '../components/blocks.js';

const KIND = {
  whatsapp: { icon: 'chat', color: '#25D366' },
  telegram: { icon: 'send', color: '#2AABEE' },
  instagram: { icon: 'image', color: '#E1306C' },
};

export default async function page(el) {
  const chans = (state.settings.support_channels || []).filter((c) => c.active !== false && /^https?:\/\//i.test(c.url || ''));
  el.innerHTML = html`<div class="page" style="max-width:720px">${raw(pageHead('الدعم الفني', '/account'))}
    <section class="panel stack">
      <p class="muted">مشكلة في طلب أو شحن؟ كلمنا على أي قناة، وجهّز رقم الفاتورة باش نخدموك أسرع.</p>
      <div class="list">${chans.map((c) => {
        const k = KIND[c.type] || { icon: 'external', color: 'var(--fog)' };
        return html`<a class="list-row" href="${c.url}" target="_blank" rel="noopener">
          <span style="width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--ink-3);color:${k.color}">${icon(k.icon)}</span>
          <span class="grow title">${c.title}</span>${icon('external', 'sm')}</a>`;
      })}</div>
      ${!chans.length ? html`<p class="muted">قنوات الدعم تتضاف قريباً.</p>` : ''}
      <div class="banner info">${icon('clock')}<span>وقت المعالجة: ${state.settings.processing_time || 'من دقيقة إلى 3 ساعات'}</span></div>
    </section></div>`.html;
}
