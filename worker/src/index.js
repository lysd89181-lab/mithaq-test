// ميثاق | MITHAQ API — Cloudflare Worker
// المتغيرات المطلوبة: FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT (Secret), ALLOWED_ORIGINS, SITE_URL (اختياري)
import { Firestore } from './lib/firestore.js';
import { ApiError } from './lib/util.js';
import { checkout } from './routes/checkout.js';
import { checkCoupon } from './routes/coupons.js';
import { createDeposit } from './routes/wallet.js';
import { registerPush, unregisterPush } from './routes/push.js';
import * as admin from './routes/admin.js';

const ROUTES = {
  'POST /v1/checkout': checkout,
  'POST /v1/coupon/check': checkCoupon,
  'POST /v1/deposit': createDeposit,
  'POST /v1/push/register': registerPush,
  'POST /v1/push/unregister': unregisterPush,
  'POST /v1/admin/orders/approve': admin.approveOrder,
  'POST /v1/admin/orders/cancel': admin.cancelOrder,
  'POST /v1/admin/deposits/approve': admin.approveDeposit,
  'POST /v1/admin/deposits/reject': admin.rejectDeposit,
  'POST /v1/admin/wallet': admin.adjustWallet,
  'POST /v1/admin/users/active': admin.setUserActive,
  'POST /v1/admin/notify': admin.sendNotification,
  'POST /v1/admin/staff': admin.upsertStaff,
  'POST /v1/admin/staff/remove': admin.removeStaff,
};

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  const ok = allowed.includes(origin) || (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && env.ALLOW_LOCALHOST === 'true');
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || 'null'),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers },
});

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/v1/health') {
      return json({ ok: true, service: 'mithaq-api', configured: !!env.FIREBASE_SERVICE_ACCOUNT }, 200, cors);
    }
    // رفض الطلبات من مواقع غريبة
    const origin = req.headers.get('Origin');
    if (origin && cors['Access-Control-Allow-Origin'] !== origin) {
      return json({ ok: false, error: 'مصدر غير مسموح', code: 'origin' }, 403, cors);
    }
    const handler = ROUTES[`${req.method} ${url.pathname}`];
    if (!handler) return json({ ok: false, error: 'غير موجود', code: 'not_found' }, 404, cors);
    try {
      const fs = new Firestore(env);
      const out = await handler(req, env, fs, ctx);
      return json(out, 200, cors);
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) return json({ ok: false, error: e.message, code: e.code }, e.status, cors);
      console.log('ERROR', url.pathname, e.stack || e.message);
      const msg = e instanceof ApiError && e.code === 'config' ? e.message : 'صار خطأ في السيرفر، حاول بعد شوية';
      return json({ ok: false, error: msg, code: 'server_error' }, 500, cors);
    }
  },
};
