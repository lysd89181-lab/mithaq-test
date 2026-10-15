// بيانات الموظف الحالي وصلاحياته
export const me = { uid: '', email: '', name: '', role: 'staff', perms: {} };
export const counts = { orders: 0, deposits: 0 };

export function setMe(v) { Object.assign(me, v); }
export function setCounts(v) { Object.assign(counts, v); }

// المدير عنده كل الصلاحيات، و'admin' تعني المدير فقط
export function can(perm) {
  if (me.role === 'admin') return true;
  if (perm === 'admin') return false;
  return me.perms?.[perm] === true;
}

export const PERM_LABELS = {
  orders: 'الطلبات',
  deposits: 'الإيداعات',
  products: 'الأقسام والمنتجات',
  stock: 'المخزون',
  users: 'المستخدمين',
  wallet: 'شحن وخصم الأرصدة',
  coupons: 'الكوبونات',
  reports: 'التقارير',
  notify: 'إرسال الإشعارات',
  settings: 'إعدادات المنصة',
  audit: 'سجل العمليات',
};
