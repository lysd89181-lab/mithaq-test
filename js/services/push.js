// إشعارات قوقل (Firebase Cloud Messaging)
import { getMessaging, getToken, onMessage, isSupported, deleteToken } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
import { app } from '../core/firebase.js';
import { VAPID_KEY } from '../core/config.js';
import { api } from '../core/api.js';
import { toast } from '../core/ui.js';

let swReg = null;
export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // ملف sw.js في جذر الموقع؛ نحسب مساره من مكان هذا الملف عشان يخدم في أي مجلد
    const swUrl = new URL('../../sw.js', import.meta.url);
    swReg = await navigator.serviceWorker.register(swUrl, { scope: new URL('../../', import.meta.url).pathname });
    return swReg;
  } catch (e) {
    console.warn('SW', e);
    return null;
  }
}

export async function pushSupported() {
  try { return 'Notification' in window && (await isSupported()); } catch { return false; }
}

export const pushState = () => ('Notification' in window ? Notification.permission : 'unsupported');

// تفعيل الإشعارات (لازم يكون من ضغطة زر)
export async function enablePush() {
  if (!(await pushSupported())) throw new Error('المتصفح هذا ما يدعمش الإشعارات. على الآيفون ثبّت الموقع على الشاشة الرئيسية أولاً');
  if (VAPID_KEY.startsWith('PASTE_')) throw new Error('مفتاح الإشعارات غير مضاف في config.js');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('رفضت الإشعارات. تقدر تفعلها من إعدادات المتصفح');
  const reg = swReg || (await registerSW());
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('تعذر تفعيل الإشعارات');
  await api('/v1/push/register', { token });
  localStorage.setItem('mq_push_token', token);
  return token;
}

export async function disablePush() {
  const token = localStorage.getItem('mq_push_token');
  if (token) {
    await api('/v1/push/unregister', { token }).catch(() => {});
    await deleteToken(getMessaging(app)).catch(() => {});
    localStorage.removeItem('mq_push_token');
  }
}

// تجديد التوكن بصمت لو الإذن موجود
export async function refreshPush() {
  if (pushState() !== 'granted' || !localStorage.getItem('mq_push_token')) return;
  try {
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg || (await registerSW()) });
    if (token && token !== localStorage.getItem('mq_push_token')) {
      await api('/v1/push/register', { token });
      localStorage.setItem('mq_push_token', token);
    }
  } catch { /* تجاهل */ }
}

// الإشعار وقت الموقع مفتوح يظهر كتنبيه داخلي
export async function listenForeground(onAny) {
  if (!(await pushSupported())) return;
  onMessage(getMessaging(app), (payload) => {
    const n = payload.notification || {};
    toast(`${n.title || ''} — ${n.body || ''}`, 'info', 6000);
    onAny && onAny(payload);
  });
}
