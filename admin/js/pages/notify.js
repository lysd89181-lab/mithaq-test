// إرسال الإشعارات
import { db, collection, query, where, limit, onSnapshot } from '../../../js/core/firebase.js';
import { html, raw, timeAgo } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { api } from '../../../js/core/api.js';
import { toast, toastErr, withLoading, confirmBox } from '../../../js/core/ui.js';
import { tsMs } from '../kit.js';

export default async function page(el) {
  el.innerHTML = html`<div class="split">
    <section class="panel"><div class="panel-title"><h2>إشعار جديد</h2></div>
      <form class="form-grid" id="f">
        <div class="field"><label>لمين؟</label><select id="to" class="select"><option value="all">كل الزبائن</option><option value="one">زبون واحد (بالمعرّف)</option></select></div>
        <div class="field" id="uidWrap" hidden><label>معرّف الزبون (UID)</label><input id="uid" class="input ltr" dir="ltr" placeholder="من صفحة المستخدمين > نسخ المعرّف"></div>
        <div class="field"><label>العنوان</label><input id="t" class="input" maxlength="80" required placeholder="عرض نهاية الأسبوع"></div>
        <div class="field"><label>النص</label><textarea id="b" class="textarea" maxlength="300" required placeholder="خصم 10% على بطاقات ببجي لين الجمعة"></textarea></div>
        <div class="field"><label>رابط عند الضغط (اختياري)</label><input id="l" class="input ltr" dir="ltr" placeholder="https://… أو اتركه فاضي"></div>
        <button class="btn btn-primary btn-block"><span class="label">${icon('send', 'sm')} إرسال</span><span class="spin"></span></button>
        <p class="hint">يوصل كإشعار للأجهزة اللي فعّلت الإشعارات، ويتسجل في صفحة الإشعارات داخل الموقع للكل.</p>
      </form></section>
    <section class="panel"><div class="panel-title"><h2>آخر الإشعارات العامة</h2></div><div id="hist" class="list"><div class="skel" style="height:100px"></div></div></section>
  </div>`.html;

  const f = el.querySelector('#f');
  f.querySelector('#to').onchange = (e) => { f.querySelector('#uidWrap').hidden = e.target.value !== 'one'; };
  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading(f.querySelector('button'), async () => {
      const one = f.querySelector('#to').value === 'one';
      const body = { title: f.querySelector('#t').value.trim(), body: f.querySelector('#b').value.trim(), link: f.querySelector('#l').value.trim() };
      if (one) { body.userId = f.querySelector('#uid').value.trim(); if (!body.userId) return toast('أدخل معرّف الزبون', 'err'); }
      if (!one && !(await confirmBox('إرسال للكل', 'الإشعار يوصل لكل الزبائن. متأكد؟', { ok: 'إرسال' }))) return;
      try {
        const r = await api('/v1/admin/notify', body);
        toast(one ? 'تم الإرسال' : `تم الإرسال لـ ${r.sent} جهاز`);
        f.reset();
      } catch (err) { toastErr(err); }
    });
  };

  return onSnapshot(query(collection(db, 'notifications'), where('userId', '==', 'all'), limit(20)), (s) => {
    const list = s.docs.map((d) => d.data()).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    el.querySelector('#hist').innerHTML = list.length ? list.map((n) => html`<div class="list-row"><span style="color:var(--crimson)">${icon('bell', 'sm')}</span><div class="grow"><div class="title" style="font-size:var(--fs-sm)">${n.title}</div><div class="sub">${n.body}</div></div><span class="hint">${timeAgo(n.createdAt)}</span></div>`.html).join('') : '<p class="muted">ما فيش إشعارات عامة بعد.</p>';
  }, () => {});
}
