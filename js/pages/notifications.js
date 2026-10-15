// مركز الإشعارات
import { html, raw, timeAgo } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { state, set } from '../core/state.js';
import { db, collection, query, where, limit, onSnapshot } from '../core/firebase.js';
import { pageHead, empty } from '../components/blocks.js';

const ICON = { order: 'receipt', deposit: 'wallet', broadcast: 'sparkle', admin: 'bell' };

export default async function page(el) {
  el.innerHTML = `<div class="page" style="max-width:720px">${pageHead('الإشعارات', '/account')}<div id="nl" class="panel"><div class="skel" style="height:120px"></div></div></div>`;
  const seen = state.lastSeenNotif || 0;
  const unsub = onSnapshot(query(collection(db, 'notifications'), where('userId', 'in', [state.user.uid, 'all']), limit(40)), (snap) => {
    const list = snap.docs.map((d) => d.data()).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    el.querySelector('#nl').innerHTML = list.length ? html`<div class="list">${list.map((n) => {
      const isNew = (n.createdAt?.toMillis?.() || 0) > seen;
      const link = /^https?:\/\//.test(n.link || '') || (n.link || '').startsWith('#') ? n.link : '';
      return html`<${raw(link ? 'a' : 'div')} class="list-row" ${link ? raw(`href="${link.replace(/"/g, '')}"`) : ''}>
        <span style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:${isNew ? 'var(--crimson-wash)' : 'var(--ink-3)'};color:${isNew ? 'var(--crimson)' : 'var(--fog)'}">${icon(ICON[n.type] || 'bell', 'sm')}</span>
        <div class="grow"><div class="title" style="font-size:var(--fs-sm)">${n.title}</div><div class="sub">${n.body}</div></div>
        <span class="hint">${timeAgo(n.createdAt)}</span></${raw(link ? 'a' : 'div')}>`;
    })}</div>`.html : empty('bell', 'ما فيش إشعارات', 'هنا تلقى تحديثات طلباتك وشحناتك.');
    set({ lastSeenNotif: Date.now(), unread: 0 });
  }, () => { el.querySelector('#nl').innerHTML = empty('alert', 'تعذر تحميل الإشعارات'); });
  return unsub;
}
