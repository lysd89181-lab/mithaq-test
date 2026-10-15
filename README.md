# ميثاق | MITHAQ

منصة ليبية لبيع البطاقات الرقمية والاشتراكات: متجر + لوحة تحكم + سيرفر آمن.
تشتغل على **GitHub Pages** (الواجهة) و **Firebase** (الحسابات وقاعدة البيانات والإشعارات) و **Cloudflare Workers** (السيرفر).

## الهيكل

```
index.html            المتجر (تطبيق صفحة وحدة بروابط #/...)
manifest.json, sw.js  التثبيت كتطبيق + استقبال الإشعارات
assets/               الشعار والأيقونات
css/                  tokens · base · components · layout
js/core/              config · firebase · api · router · state · ui · utils · icons
js/services/          catalog · cart · push
js/components/        قطع الواجهة المشتركة
js/pages/             صفحات المتجر
auth/                 الدخول، حساب جديد، تأكيد البريد، استرجاع كلمة المرور
admin/                لوحة التحكم (صفحة لكل قسم في admin/js/pages)
worker/               السيرفر: src/ (الكود) و dist/worker.js (ملف واحد للصق في Cloudflare)
firestore.rules       قواعد قاعدة البيانات
```

## الأمان باختصار

- أي عملية فيها فلوس (شراء، شحن، استرجاع، شحن يدوي) تتم في السيرفر فقط، داخل معاملة (Transaction).
- السعر يتحسب في السيرفر من قاعدة البيانات، والمتصفح ما يقدرش يغيّره.
- القواعد تمنع أي مستخدم أو موظف يعدّل رصيد من المتصفح.
- أكواد المخزون ما يقراها إلا اللي عنده صلاحية المخزون.
- تأكيد البريد إجباري قبل الشراء (يتطفى من الإعدادات).
- حماية من التكرار: نفس عملية الشراء ما تتنفذش مرتين، و4 ثواني بين كل شراء، و3 طلبات شحن معلقة كحد أقصى.
- كل عملية إدارية تتسجل في سجل العمليات.

## الإعداد

1. `js/core/config.js`: حط رابط الـ Worker في `API_BASE` ومفتاح الإشعارات في `VAPID_KEY`.
2. Cloudflare: الصق `worker/dist/worker.js` وأضف المتغيرات:
   `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS`, `SITE_URL`, و `FIREBASE_SERVICE_ACCOUNT` (Secret).
3. Firebase: الصق `firestore.rules` في Firestore > Rules واضغط Publish.
4. أي تعديل في `worker/src` → شغّل `node worker/build.mjs` وانسخ `dist/worker.js` من جديد.

> ملاحظة: بعد نشر القواعد الجديدة، لوحة التحكم القديمة ما تقدرش تعدّل الأرصدة مباشرة. استعمل اللوحة الجديدة.
