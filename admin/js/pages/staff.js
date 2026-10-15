// الموظفين والصلاحيات (للمدير فقط)
import { db, collection, onSnapshot } from '../../../js/core/firebase.js';
import { html, raw } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { api } from '../../../js/core/api.js';
import { toast, toastErr, sheet, confirmBox, withLoading } from '../../../js/core/ui.js';
import { me, PERM_LABELS } from '../session.js';

export default async function page(el) {
  let list = [];
  el.innerHTML = html`<section class="stack">
    <div class="toolbar"><p class="muted grow">الموظف يسجّل حساب عادي في الموقع، وبعدها تضيفه هنا بإيميله وتختار صلاحياته.</p>
      <button class="btn btn-primary btn-sm" id="add">${icon('plus', 'sm')}<span>إضافة موظف</span></button></div>
    <div class="stack" id="list"><div class="skel" style="height:90px"></div></div></section>`.html;

  const unsub = onSnapshot(collection(db, 'admins'), (s) => {
    list = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
    el.querySelector('#list').innerHTML = list.map((a) => {
      const perms = a.role === 'admin' ? ['كل الصلاحيات'] : Object.entries(a.perms || {}).filter(([, v]) => v).map(([k]) => PERM_LABELS[k] || k);
      return html`<div class="panel row" style="align-items:flex-start;flex-wrap:wrap">
        <div class="avatar" style="width:44px;height:44px;border-radius:14px;font-size:1rem">${(a.name || a.email || 'م').slice(0, 1)}</div>
        <div class="grow" style="min-width:200px"><div class="row" style="gap:8px"><b>${a.name || a.email || a.uid}</b><span class="badge ${a.role === 'admin' ? 'red' : 'neutral'}">${a.role === 'admin' ? 'مدير' : 'موظف'}</span>${a.uid === me.uid ? html`<span class="hint">(أنت)</span>` : ''}</div>
          <div class="hint ltr" style="text-align:right">${a.email || a.uid}</div>
          <div class="chips" style="margin-top:8px">${perms.length ? perms.map((p) => html`<span class="badge neutral">${p}</span>`) : html`<span class="hint">بدون صلاحيات</span>`}</div></div>
        ${a.uid !== me.uid ? html`<div class="row"><button class="btn btn-ghost btn-sm" data-edit="${a.uid}">${icon('edit', 'sm')}<span>تعديل</span></button><button class="btn btn-danger btn-sm" data-del="${a.uid}">${icon('trash', 'sm')}</button></div>` : ''}
      </div>`.html;
    }).join('');
  });

  el.querySelector('#add').onclick = () => form(null);
  el.querySelector('#list').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    const dl = e.target.closest('[data-del]');
    if (ed) form(list.find((a) => a.uid === ed.dataset.edit));
    if (dl) {
      const a = list.find((x) => x.uid === dl.dataset.del);
      if (!(await confirmBox('إزالة الموظف', `${a.name || a.email} يرجع زبون عادي بدون أي صلاحية.`, { ok: 'إزالة', danger: true }))) return;
      try { await api('/v1/admin/staff/remove', { uid: a.uid }); toast('تمت الإزالة'); } catch (err) { toastErr(err); }
    }
  });
  return unsub;
}

function form(a) {
  const s = sheet(a ? 'تعديل الصلاحيات' : 'إضافة موظف', html`<form class="form-grid" id="f">
    <div class="field"><label>البريد الإلكتروني لحسابه في الموقع</label><input id="em" class="input ltr" dir="ltr" type="email" required value="${a?.email || ''}" ${a ? raw('readonly') : ''}></div>
    <div class="field"><label>الاسم (يظهر في سجل العمليات)</label><input id="nm" class="input" value="${a?.name || ''}" maxlength="60"></div>
    <div class="field"><label>الدور</label><select id="role" class="select"><option value="staff" ${a?.role !== 'admin' ? raw('selected') : ''}>موظف (صلاحيات محددة)</option><option value="admin" ${a?.role === 'admin' ? raw('selected') : ''}>مدير (كل شي)</option></select></div>
    <div class="form-section" id="perms"><h4>الصلاحيات</h4><div class="perm-grid">
      ${Object.entries(PERM_LABELS).map(([k, l]) => html`<label class="toggle-row"><span>${l}</span><span class="switch"><input type="checkbox" data-perm="${k}" ${a?.perms?.[k] ? raw('checked') : ''}><span></span></span></label>`)}
    </div><p class="hint">نصيحة: "شحن وخصم الأرصدة" خليها للناس اللي تثق فيهم بس.</p></div>
    <button class="btn btn-primary btn-block"><span class="label">حفظ</span><span class="spin"></span></button></form>`.html, { wide: true });
  const f = s.el.querySelector('#f');
  const sync = () => { f.querySelector('#perms').hidden = f.querySelector('#role').value === 'admin'; };
  f.querySelector('#role').onchange = sync;
  sync();
  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading(f.querySelector('button.btn'), async () => {
      const perms = {};
      f.querySelectorAll('[data-perm]').forEach((c) => { perms[c.dataset.perm] = c.checked; });
      try {
        await api('/v1/admin/staff', { uid: a?.uid || '', email: f.querySelector('#em').value.trim(), name: f.querySelector('#nm').value.trim(), role: f.querySelector('#role').value, perms });
        toast('تم الحفظ');
        s.close();
      } catch (err) { toastErr(err); }
    });
  };
}
