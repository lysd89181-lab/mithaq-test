// تسجيل أجهزة الإشعارات
import { requireUser } from '../lib/context.js';
import { fail, readJson, sha256Hex, str } from '../lib/util.js';

export async function registerPush(req, env, fs) {
  const user = await requireUser(req, env, fs, { verified: false });
  const body = await readJson(req);
  const token = str(body.token, 600);
  if (token.length < 20) fail(400, 'توكن غير صالح');
  const id = (await sha256Hex(token)).slice(0, 40);
  const staff = await fs.get(`admins/${user.uid}`);
  await fs.commit([fs.wSet(`push_tokens/${id}`, {
    token, uid: user.uid, isStaff: !!staff, ua: str(req.headers.get('User-Agent'), 160), updatedAt: new Date(),
  })]);
  return { ok: true };
}

export async function unregisterPush(req, env, fs) {
  const user = await requireUser(req, env, fs, { verified: false });
  const body = await readJson(req);
  const token = str(body.token, 600);
  if (token) {
    const path = `push_tokens/${(await sha256Hex(token)).slice(0, 40)}`;
    const doc = await fs.get(path);
    if (doc && doc.data.uid === user.uid) await fs.commit([fs.wDelete(path)]);
  }
  return { ok: true };
}
