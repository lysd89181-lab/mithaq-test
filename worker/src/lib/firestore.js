// عميل Firestore REST بصلاحية حساب الخدمة (يتجاوز القواعد) مع دعم المعاملات (Transactions)
import { accessToken, projectId } from './google.js';
import { ApiError, fail } from './util.js';

export function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { nullValue: null };
    return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  return { stringValue: String(v) };
}
export function encodeFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) f[k] = encode(v);
  return f;
}
export function decode(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}
export function decodeFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields || {})) o[k] = decode(v);
  return o;
}

const OPS = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', in: 'IN', 'array-contains': 'ARRAY_CONTAINS' };

export class Firestore {
  constructor(env) {
    this.env = env;
    this.root = `projects/${projectId(env)}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
  }
  name(path) { return `${this.root}/${path}`; }

  async req(method, url, body) {
    const token = await accessToken(this.env);
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const out = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const status = out.error?.status || '';
      const err = new ApiError(res.status === 409 || status === 'ABORTED' ? 409 : 500, out.error?.message || 'Firestore error', status || 'firestore');
      err.fsStatus = status;
      err.httpStatus = res.status;
      throw err;
    }
    return out;
  }

  docFrom(d) {
    const path = d.name.slice(this.root.length + 1);
    return { id: path.split('/').pop(), path, data: decodeFields(d.fields), updateTime: d.updateTime };
  }

  async get(path, tx) {
    const q = tx ? `?transaction=${encodeURIComponent(tx)}` : '';
    try {
      return this.docFrom(await this.req('GET', `${this.base}/${path}${q}`));
    } catch (e) {
      if (e.httpStatus === 404) return null;
      throw e;
    }
  }

  // filters: [['field','==',value], ...]
  async query(collection, filters = [], opts = {}, tx) {
    const sq = { from: [{ collectionId: collection }] };
    const fs = filters.map(([field, op, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: OPS[op], value: encode(value) } }));
    if (fs.length === 1) sq.where = fs[0];
    else if (fs.length > 1) sq.where = { compositeFilter: { op: 'AND', filters: fs } };
    if (opts.orderBy) sq.orderBy = [{ field: { fieldPath: opts.orderBy }, direction: opts.desc ? 'DESCENDING' : 'ASCENDING' }];
    if (opts.limit) sq.limit = opts.limit;
    const body = { structuredQuery: sq };
    if (tx) body.transaction = tx;
    const out = await this.req('POST', `${this.base}:runQuery`, body);
    return (Array.isArray(out) ? out : []).filter((r) => r.document).map((r) => this.docFrom(r.document));
  }

  // ===== بناء عمليات الكتابة =====
  wSet(path, data) { return { update: { name: this.name(path), fields: encodeFields(data) } }; }
  wCreate(path, data) { return { ...this.wSet(path, data), currentDocument: { exists: false } }; }
  wUpdate(path, data) {
    return { update: { name: this.name(path), fields: encodeFields(data) }, updateMask: { fieldPaths: Object.keys(data) }, currentDocument: { exists: true } };
  }
  wIncrement(path, field, by) {
    return { transform: { document: this.name(path), fieldTransforms: [{ fieldPath: field, increment: encode(by) }] } };
  }
  wDelete(path) { return { delete: this.name(path) }; }

  async commit(writes, tx) {
    if (!writes.length) return;
    const body = { writes };
    if (tx) body.transaction = tx;
    return this.req('POST', `${this.base}:commit`, body);
  }

  // تنفيذ معاملة كاملة مع إعادة المحاولة عند التعارض
  async transaction(fn, attempts = 4) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      const { transaction: tx } = await this.req('POST', `${this.base}:beginTransaction`, { options: { readWrite: {} } });
      // نجمع الكتابات لكل مستند في كتابة وحدة (Firestore ما يقبلش تعديل نفس المستند مرتين في commit)
      const ops = new Map();
      const op = (p) => { if (!ops.has(p)) ops.set(p, { kind: null, data: {}, inc: {} }); return ops.get(p); };
      const t = {
        get: (p) => this.get(p, tx),
        query: (c, f, o) => this.query(c, f, o, tx),
        set: (p, d) => { const o = op(p); o.kind = 'set'; o.data = { ...d }; },
        create: (p, d) => { const o = op(p); o.kind = 'create'; o.data = { ...d }; },
        update: (p, d) => { const o = op(p); if (!o.kind) o.kind = 'update'; Object.assign(o.data, d); },
        increment: (p, f, n) => { const o = op(p); o.inc[f] = (o.inc[f] || 0) + n; },
        delete: (p) => { const o = op(p); o.kind = 'delete'; },
      };
      try {
        const result = await fn(t);
        const writes = [];
        for (const [p, o] of ops) {
          const transforms = Object.entries(o.inc).map(([field, by]) => ({ fieldPath: field, increment: encode(by) }));
          if (o.kind === 'delete') { writes.push(this.wDelete(p)); continue; }
          if (!o.kind) { writes.push({ transform: { document: this.name(p), fieldTransforms: transforms } }); continue; }
          const w = o.kind === 'set' ? this.wSet(p, o.data) : o.kind === 'create' ? this.wCreate(p, o.data) : this.wUpdate(p, o.data);
          if (transforms.length) w.updateTransforms = transforms;
          writes.push(w);
        }
        if (writes.length) await this.commit(writes, tx);
        else await this.req('POST', `${this.base}:rollback`, { transaction: tx }).catch(() => {});
        return result;
      } catch (e) {
        if (e.fsStatus === 'ABORTED') { lastErr = e; await new Promise((r) => setTimeout(r, 120 * (i + 1))); continue; }
        await this.req('POST', `${this.base}:rollback`, { transaction: tx }).catch(() => {});
        if (e.fsStatus === 'ALREADY_EXISTS' || (e.fsStatus === 'FAILED_PRECONDITION' && /exist/i.test(e.message))) {
          fail(409, 'هذا الطلب تم تنفيذه مسبقاً', 'duplicate');
        }
        throw e;
      }
    }
    throw lastErr || new ApiError(503, 'الضغط عالي، حاول مرة أخرى');
  }
}
