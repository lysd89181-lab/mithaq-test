// ميثاق | MITHAQ — Service Worker: تشغيل كتطبيق (PWA) + استقبال إشعارات قوقل
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// نفس مفاتيح js/core/config.js (الـ Service Worker ما يقدرش يستورد الملف)
firebase.initializeApp({
  apiKey: 'AIzaSyD-UBxePNmnAlJJSSIQTRqHieQlQHUVM60',
  authDomain: 'iqplus-a5039.firebaseapp.com',
  projectId: 'iqplus-a5039',
  storageBucket: 'iqplus-a5039.firebasestorage.app',
  messagingSenderId: '464664905054',
  appId: '1:464664905054:web:6f623642493b2c61357bcf',
});
// الإشعارات اللي فيها notification يعرضها Firebase تلقائياً لما الموقع مقفول
firebase.messaging();

const VERSION = 'mq-v1';
const CORE = ['./', './index.html', './manifest.json', './assets/icon-192.png', './assets/logo-mark.png', './css/tokens.css', './css/base.css', './css/components.css', './css/layout.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// الصفحات: الشبكة أولاً. الملفات الثابتة: من الكاش مع تحديث في الخلفية
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  if (/\.(css|js|png|svg|jpg|webp|json)$/.test(url.pathname)) {
    e.respondWith(caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

self.addEventListener('notificationclick', (e) => {
  const link = e.notification?.data?.FCM_MSG?.data?.link || e.notification?.data?.link || './';
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate(link).catch(() => {}); return c.focus(); }
    return clients.openWindow(link);
  }));
});
