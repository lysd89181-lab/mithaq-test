// الكوبونات
import { db, collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp, Timestamp } from '../../../js/core/firebase.js';
import { html, raw, fmtDate } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { toast, toastErr, sheet, confirmBox, withLoading } from '../../../js/core/ui.js';
import { lyd, emptyRow, formData, sw, tsMs, audit } from '../kit.js';

export default async function page(el) {
  let list = [];
  el.innerHTML = html`<section class="stack">
    <div class="toolbar"><p class="muted grow">الزبون يكتب الكود في السلة، والسيرفر يتحقق منه ويحسب الخصم.</p>
      <button class="btn btn-primary btn-sm" id="add">${icon('plus', 'sm')}<span>كوبون جديد</span></button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>الكود</th><th>الخصم</th><th>الاستخدام</th><th>الحد الأدنى</th><th>ينتهي</th><th>الحالة</th><th></th></tr></thead>
    <tbody id="tb">${raw(emptyRow(7, 'جاري التحميل…'))}</tbody></table></div></section>`.html;

  const unsub = onSnapshot(collection(db, 'coupons'), (s) => {
    list = s.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    el.querySelector('#tb').innerHTML = list.length ? list.map((c) => {
      const expired = c.expiresAt && tsMs(c.expiresAt) < Date.now();
      const out = Number(c.maxUses) > 0 && Number(c.usedCount) >= Number(c.maxUses);
      const state = c.active === false ? ['neutral', 'متوقف'] : expired ? ['bad', 'منتهي'] : out ? ['bad', 'مستنفد'] : ['ok', 'فعّال'];
      return html`<tr><td data-label="الكود" class="num strong">${c.code}</td>
        <td data-label="الخصم">${c.type === 'fixed' ? lyd(c.value) : `${c.value}%`}${c.type !== 'fixed' && Number(c.maxDiscount) ? html` <span class="hint">حتى ${lyd(c.maxDiscount)}</span>` : ''}</td>
        <td data-label="الاستخدام" class="num">${Number(c.usedCount) || 0}${Number(c.maxUses) ? ` / ${c.maxUses}` : ''}</td>
        <td data-label="الحد الأدنى">${Number(c.minAmount) ? lyd(c.minAmount) : '—'}</td>
        <td data-label="ينتهي" class="hint">${c.expiresAt ? fmtDate(c.expiresAt, false) : 'بدون'}</td>
        <td data-label="الحالة"><span class="badge ${state[0]}">${state[1]}</span></td>
        <td class="acts-cell"><div class="acts"><button class="btn btn-ghost btn-sm" data-edit="${c.code}">${icon('edit', 'sm')}</button><button class="btn btn-danger btn-sm" data-del="${c.code}">${icon('trash', 'sm')}</button></div></td></tr>`.html;
    }).join('') : emptyRow(7, 'ما فيش كوبونات. أنشئ أول كوبون.');
  });

  el.querySelector('#add').onclick = () => form(null);
  el.querySelector('#tb').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    const dl = e.target.closest('[data-del]');
    if (ed) form(list.find((c) => c.code === ed.dataset.edit));
    if (dl && (await confirmBox('حذف الكوبون', `حذف ${dl.dataset.del}؟`, { ok: 'حذف', danger: true }))) {
      try { await deleteDoc(doc(db, 'coupons', dl.dataset.del)); audit('coupon_deleted', { code: dl.dataset.del }); toast('تم الحذف'); } catch (err) { toastErr(err); }
    }
  });
  return unsub;
}

function form(c) {
  const exp = c?.expiresAt ? new Date(tsMs(c.expiresAt)).toISOString().slice(0, 10) : '';
  const s = sheet(c ? `تعديل ${c.code}` : 'كوبون جديد', html`<form class="form-grid" id="f">
    <div class="field"><label>الكود</label><input name="code" class="input ltr" dir="ltr" required pattern="[A-Za-z0-9_-]{3,30}" value="${c?.code || ''}" ${c ? raw('readonly') : ''} placeholder="RAMADAN10" style="text-transform:uppercase"></div>
    <div class="split even">
      <div class="field"><label>النوع</label><select name="type" class="select"><option value="percent" ${c?.type !== 'fixed' ? raw('selected') : ''}>نسبة %</option><option value="fixed" ${c?.type === 'fixed' ? raw('selected') : ''}>مبلغ ثابت د.ل</option></select></div>
      <div class="field"><label>القيمة</label><input name="value" type="number" step="0.01" min="0.01" class="input ltr" dir="ltr" required value="${c?.value ?? ''}"></div>
      <div class="field"><label>أقصى خصم (للنسبة، اختياري)</label><input name="maxDiscount" type="number" step="0.01" min="0" class="input ltr" dir="ltr" value="${c?.maxDiscount ?? ''}"></div>
      <div class="field"><label>أقل قيمة للطلب</label><input name="minAmount" type="number" step="0.01" min="0" class="input ltr" dir="ltr" value="${c?.minAmount ?? ''}"></div>
      <div class="field"><label>عدد الاستخدامات الكلي (0 = بلا حد)</label><input name="maxUses" type="number" min="0" class="input ltr" dir="ltr" value="${c?.maxUses ?? 0}"></div>
      <div class="field"><label>لكل زبون (0 = بلا حد)</label><input name="perUserLimit" type="number" min="0" class="input ltr" dir="ltr" value="${c?.perUserLimit ?? 1}"></div>
    </div>
    <div class="field"><label>تاريخ الانتهاء (اختياري)</label><input name="expiresAt" type="date" class="input ltr" dir="ltr" value="${exp}"></div>
    ${raw(sw('active', c ? c.active !== false : true, 'الكوبون فعّال').html)}
    <button class="btn btn-primary btn-block"><span class="label">حفظ</span><span class="spin"></span></button></form>`.html);
  const f = s.el.querySelector('#f');
  f.onsubmit = (e) => {
    e.preventDefault();
    withLoading(f.querySelector('button'), async () => {
      const d = formData(f);
      const code = d.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (code.length < 3) return toast('الكود 3 أحرف على الأقل (إنجليزي وأرقام)', 'err');
      if (d.type === 'percent' && d.value > 100) return toast('النسبة ما تزيدش عن 100', 'err');
      const data = {
        type: d.type, value: d.value, maxDiscount: d.maxDiscount || 0, minAmount: d.minAmount || 0, maxUses: d.maxUses || 0,
        perUserLimit: d.perUserLimit ?? 1, active: d.active, expiresAt: d.expiresAt ? Timestamp.fromDate(new Date(`${d.expiresAt}T23:59:59`)) : null,
      };
      try {
        if (c) await updateDoc(doc(db, 'coupons', code), data);
        else {
          if ((await getDoc(doc(db, 'coupons', code))).exists()) return toast('الكود هذا موجود', 'err');
          await setDoc(doc(db, 'coupons', code), { ...data, usedCount: 0, createdAt: serverTimestamp() });
        }
        audit(c ? 'coupon_updated' : 'coupon_created', { code });
        toast('تم حفظ الكوبون');
        s.close();
      } catch (err) { toastErr(err); }
    });
  };
}
