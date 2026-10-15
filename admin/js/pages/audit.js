// سجل العمليات
import { db, collection, query, orderBy, limit, getDocs } from '../../../js/core/firebase.js';
import { html, raw, fmtDate, debounce } from '../../../js/core/utils.js';
import { icon } from '../../../js/core/icons.js';
import { lyd, emptyRow } from '../kit.js';

const TYPES = {
  order_approved: 'تنفيذ طلب', order_refund: 'إلغاء وإرجاع طلب', order_deleted: 'حذف طلب',
  deposit_approved: 'قبول إيداع', deposit_rejected: 'رفض إيداع',
  manual_credit: 'إضافة رصيد يدوي', manual_debit: 'خصم رصيد يدوي',
  user_suspended: 'إيقاف مستخدم', user_activated: 'تفعيل مستخدم',
  staff_saved: 'تعديل موظف', staff_removed: 'إزالة موظف', notification_sent: 'إرسال إشعار',
  price_changed: 'تغيير سعر', product_deleted: 'حذف منتج', products_deleted: 'حذف منتجات', category_deleted: 'حذف قسم',
  stock_added: 'إضافة مخزون', stock_deleted: 'حذف كود', shared_account_added: 'إضافة حساب مشترك', shared_account_reset: 'تصفير حساب مشترك',
  coupon_created: 'إنشاء كوبون', coupon_updated: 'تعديل كوبون', coupon_deleted: 'حذف كوبون', settings_saved: 'حفظ الإعدادات',
};

export default async function page(el) {
  let rows = [];
  let term = '';
  el.innerHTML = html`<section class="stack">
    <div class="toolbar"><div class="input-wrap">${icon('search')}<input class="input" id="q" placeholder="بحث بالموظف أو العملية أو المعرّف"></div></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>الوقت</th><th>الموظف</th><th>العملية</th><th>التفاصيل</th><th>المبلغ</th></tr></thead>
    <tbody id="tb">${raw(emptyRow(5, 'جاري التحميل…'))}</tbody></table></div></section>`.html;
  const s = await getDocs(query(collection(db, 'audit_logs'), orderBy('at', 'desc'), limit(300)));
  rows = s.docs.map((d) => d.data());
  const draw = () => {
    const list = rows.filter((r) => !term || JSON.stringify(r).toLowerCase().includes(term) || (TYPES[r.type] || '').includes(term));
    el.querySelector('#tb').innerHTML = list.length ? list.map((r) => {
      const detail = [r.name, r.title, r.code, r.reason, r.note, r.orderId && `طلب ${r.orderId}`, r.depositId && `إيداع ${r.depositId.slice(0, 8)}`, r.userId && `مستخدم ${r.userId.slice(0, 8)}`, r.count && `${r.count} عنصر`,
        r.from !== undefined && `${lyd(r.from)} ← ${lyd(r.to)}`, r.balanceAfter !== undefined && r.balanceAfter !== null && `الرصيد بعد: ${lyd(r.balanceAfter)}`].filter(Boolean).join(' · ');
      return html`<tr><td data-label="الوقت" class="hint">${fmtDate(r.at)}</td><td data-label="الموظف" class="strong">${r.byName || (r.by || '').slice(0, 8)}</td>
        <td data-label="العملية">${TYPES[r.type] || r.type}</td><td data-label="التفاصيل" class="full hint" style="overflow-wrap:anywhere">${detail || '—'}</td>
        <td data-label="المبلغ" class="num">${r.amount !== undefined ? lyd(r.amount) : '—'}</td></tr>`.html;
    }).join('') : emptyRow(5, 'ما فيش عمليات مسجلة');
  };
  el.querySelector('#q').oninput = debounce((e) => { term = e.target.value.trim().toLowerCase(); draw(); }, 200);
  draw();
}
