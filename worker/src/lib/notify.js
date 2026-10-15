// إشعارات قوقل (FCM) + سجل الإشعارات داخل الموقع
import { accessToken, projectId } from './google.js';
import { randomId } from './util.js';

// معرّف يترتب من الأحدث للأقدم تلقائياً (Firestore يرتب حسب المعرّف)
const newestFirstId = () => `${String(9999999999999 - Date.now()).padStart(13, '0')}${randomId(6)}`;

async function sendToToken(env, fs, tokenDoc, msg) {
  const token = await accessToken(env);
  const link = msg.link || env.SITE_URL || '';
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId(env)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: tokenDoc.data.token,
        notification: { title: msg.title, body: msg.body },
        data: { link, type: msg.type || 'general' },
        webpush: {
          notification: { icon: msg.icon || (env.SITE_URL ? `${env.SITE_URL}/assets/icon-192.png` : undefined), dir: 'rtl', lang: 'ar' },
          fcm_options: link ? { link } : undefined,
        },
      },
    }),
  });
  if (!res.ok) {
    const out = await res.json().catch(() => ({}));
    const code = out.error?.details?.[0]?.errorCode || out.error?.status;
    // توكن منتهي: نمسحه
    if (res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') {
      await fs.commit([fs.wDelete(tokenDoc.path)]).catch(() => {});
    }
  }
}

async function sendMany(env, fs, tokens, msg) {
  const list = tokens.slice(0, 500);
  for (let i = 0; i < list.length; i += 20) {
    await Promise.allSettled(list.slice(i, i + 20).map((t) => sendToToken(env, fs, t, msg)));
  }
}

// إشعار لزبون معيّن (ويتسجل في مركز الإشعارات)
export async function notifyUser(env, fs, userId, msg) {
  try {
    await fs.commit([fs.wSet(`notifications/${newestFirstId()}`, {
      userId, title: msg.title, body: msg.body, link: msg.link || '', type: msg.type || 'general', createdAt: new Date(),
    })]);
    const tokens = await fs.query('push_tokens', [['uid', '==', userId]], { limit: 20 });
    await sendMany(env, fs, tokens, msg);
  } catch (e) {
    console.log('notifyUser failed', e.message);
  }
}

// إشعار لكل الإدارة والموظفين
export async function notifyStaff(env, fs, msg) {
  try {
    const tokens = await fs.query('push_tokens', [['isStaff', '==', true]], { limit: 100 });
    await sendMany(env, fs, tokens, { ...msg, link: msg.link || (env.SITE_URL ? `${env.SITE_URL}/admin/` : '') });
  } catch (e) {
    console.log('notifyStaff failed', e.message);
  }
}

// إشعار عام لكل الزبائن
export async function notifyAll(env, fs, msg) {
  await fs.commit([fs.wSet(`notifications/${newestFirstId()}`, {
    userId: 'all', title: msg.title, body: msg.body, link: msg.link || '', type: 'broadcast', createdAt: new Date(),
  })]);
  const tokens = await fs.query('push_tokens', [], { limit: 500 });
  await sendMany(env, fs, tokens, msg);
  return tokens.length;
}
