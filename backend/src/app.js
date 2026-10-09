import http from 'node:http';
import crypto from 'node:crypto';
import { openDb, tx } from './db.js';
import { createSecurity } from './security.js';
import { createLimiter } from './ratelimit.js';
import { log } from './log.js';

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

const USERNAME_RE = /^(?=.{3,24}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;
const SMALL = 16 * 1024, STATE_MAX = 3 * 1024 * 1024;

const normName = n => n.normalize('NFKC').trim().toLowerCase();
function validUsername(v) {
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_username', 'Invalid username');
  const u = v.normalize('NFKC').trim();
  if (!USERNAME_RE.test(u)) throw new HttpError(400, 'invalid_username', 'Username must be 3-24 letters, digits, _ . - and single spaces between words');
  return u;
}
function validPassword(p, username) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 128) throw new HttpError(400, 'invalid_password', 'Password must be 8-128 characters');
  if (/^(.)\1+$/u.test(p) || normName(p) === normName(username)) throw new HttpError(400, 'weak_password', 'Password is too weak');
  return p;
}

export function createApp(cfg) {
  const db = openDb(cfg.dbPath);
  const sec = createSecurity(cfg);
  const limiter = createLimiter();
  const routes = new Map();
  const route = (method, path, opts, fn) => routes.set(`${method} ${path}`, { opts, fn });
  const paths = new Set();

  const now = () => Date.now();
  const audit = (userId, event, ip) =>
    db.prepare('INSERT INTO audit_log (ts, user_id, event, ip_hash) VALUES (?,?,?,?)').run(now(), userId, event, sec.ipHash(ip));

  function issueTokens(user, familyId = crypto.randomUUID()) {
    const refreshToken = sec.newRefreshToken();
    db.prepare('INSERT INTO refresh_tokens (id,user_id,family_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)')
      .run(crypto.randomUUID(), user.id, familyId, sec.hashToken(refreshToken), now() + cfg.refreshTtlDays * 864e5, now());
    return { accessToken: sec.signAccess(user), refreshToken, expiresIn: cfg.accessTtl, user: { id: user.id, username: user.username, role: user.role } };
  }

  // ---------- routes ----------
  route('GET', '/healthz', {}, () => { db.prepare('SELECT 1').get(); return { status: 200, json: { status: 'ok' } }; });

  route('POST', '/api/auth/register', { auth: false, authLimit: true, body: SMALL }, async ({ body, ip }) => {
    const username = validUsername(body.username);
    const password = validPassword(body.password, username);
    const pw_hash = await sec.hashPassword(password);
    const user = { id: crypto.randomUUID(), username, role: 'learner' };
    try {
      tx(db, () => {
        db.prepare('INSERT INTO users (id,username,username_norm,pw_hash,role,created_at) VALUES (?,?,?,?,?,?)')
          .run(user.id, username, normName(username), pw_hash, user.role, now());
        audit(user.id, 'register', ip);
      });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'username_taken', 'Username already taken');
      throw e;
    }
    return { status: 201, json: tx(db, () => issueTokens(user)) };
  });

  route('POST', '/api/auth/login', { auth: false, authLimit: true, body: SMALL }, async ({ body, ip }) => {
    const GENERIC = new HttpError(401, 'invalid_credentials', 'Invalid username or password');
    if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 128) throw GENERIC;
    const row = db.prepare('SELECT * FROM users WHERE username_norm = ?').get(normName(body.username));
    if (!row) { await sec.dummyVerify(body.password); throw GENERIC; }
    if (row.locked_until > now()) {
      const s = Math.ceil((row.locked_until - now()) / 1000);
      throw new HttpError(429, 'account_locked', 'Too many failed attempts. Try again later.', { retryAfter: s });
    }
    const { ok, rehash } = await sec.verifyPassword(body.password, row.pw_hash);
    if (!ok) {
      const fails = row.failed_logins + 1;
      const lock = fails >= 5 ? now() + Math.min(900, 30 * 2 ** (fails - 5)) * 1000 : 0;
      db.prepare('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?').run(fails, lock, row.id);
      audit(row.id, 'login_failed', ip);
      throw GENERIC;
    }
    const newHash = rehash ? await sec.hashPassword(body.password) : row.pw_hash;
    const out = tx(db, () => {
      db.prepare('UPDATE users SET failed_logins=0, locked_until=0, pw_hash=? WHERE id=?').run(newHash, row.id);
      audit(row.id, 'login', ip);
      return issueTokens(row);
    });
    return { status: 200, json: out };
  });

  route('POST', '/api/auth/refresh', { auth: false, authLimit: true, body: SMALL }, ({ body, ip }) => {
    if (typeof body.refreshToken !== 'string') throw new HttpError(401, 'invalid_token', 'Invalid token');
    const out = tx(db, () => {
      const t = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sec.hashToken(body.refreshToken));
      if (!t) return null;
      if (t.revoked_at) { // reuse of a rotated token => assume theft, kill the whole family
        db.prepare('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?').run(now(), t.family_id);
        audit(t.user_id, 'refresh_reuse_detected', ip);
        return null;
      }
      if (t.expires_at < now()) return null;
      const user = db.prepare('SELECT id,username,role FROM users WHERE id=?').get(t.user_id);
      if (!user) return null;
      const next = issueTokens(user, t.family_id);
      db.prepare('UPDATE refresh_tokens SET revoked_at=?, replaced_by=? WHERE id=?').run(now(), sec.hashToken(next.refreshToken), t.id);
      return next;
    });
    if (!out) throw new HttpError(401, 'invalid_token', 'Invalid token');
    return { status: 200, json: out };
  });

  route('POST', '/api/auth/logout', { auth: false, authLimit: true, body: SMALL }, ({ body }) => {
    if (typeof body.refreshToken === 'string') {
      const t = db.prepare('SELECT family_id FROM refresh_tokens WHERE token_hash=?').get(sec.hashToken(body.refreshToken));
      if (t) db.prepare('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id=?').run(now(), t.family_id);
    }
    return { status: 204 };
  });

  route('GET', '/api/me', { auth: true }, ({ user }) => ({ status: 200, json: { id: user.id, username: user.username, role: user.role } }));

  route('GET', '/api/state', { auth: true }, ({ user }) => {
    const r = db.prepare('SELECT data,version,updated_at FROM user_state WHERE user_id=?').get(user.id); // user id from token only (no IDOR)
    return { status: 200, json: r ? { version: r.version, updatedAt: r.updated_at, state: JSON.parse(r.data) } : { version: 0, updatedAt: 0, state: null } };
  });

  route('PUT', '/api/state', { auth: true, body: STATE_MAX }, ({ user, body, ip }) => {
    if (!Number.isInteger(body.baseVersion) || body.baseVersion < 0) throw new HttpError(400, 'invalid_request', 'baseVersion required');
    if (body.state === null || typeof body.state !== 'object' || Array.isArray(body.state)) throw new HttpError(400, 'invalid_request', 'state must be an object');
    const data = JSON.stringify(body.state);
    return tx(db, () => {
      const cur = db.prepare('SELECT data,version FROM user_state WHERE user_id=?').get(user.id);
      const curV = cur ? cur.version : 0;
      if (curV !== body.baseVersion) throw new HttpError(409, 'version_conflict', 'State changed on another device', { version: curV, state: cur ? JSON.parse(cur.data) : null });
      db.prepare(`INSERT INTO user_state (user_id,data,version,updated_at) VALUES (?,?,?,?)
                  ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=excluded.updated_at`)
        .run(user.id, data, curV + 1, now());
      return { status: 200, json: { version: curV + 1 } };
    });
  });

  route('DELETE', '/api/account', { auth: true, authLimit: true, body: SMALL }, async ({ user, body, ip }) => {
    const row = db.prepare('SELECT pw_hash FROM users WHERE id=?').get(user.id);
    const { ok } = typeof body.password === 'string' && body.password.length <= 128 ? await sec.verifyPassword(body.password, row.pw_hash) : { ok: false };
    if (!ok) throw new HttpError(403, 'invalid_credentials', 'Invalid password');
    tx(db, () => { audit(null, 'account_deleted', ip); db.prepare('DELETE FROM users WHERE id=?').run(user.id); });
    return { status: 204 };
  });

  for (const k of routes.keys()) paths.add(k.split(' ')[1]);

  // ---------- plumbing ----------
  const clientIp = req => {
    if (cfg.trustProxy) { const x = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim(); if (x) return x; }
    return req.socket.remoteAddress || 'unknown';
  };

  function readJson(req, res, limit) {
    return new Promise((resolve, reject) => {
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return reject(new HttpError(415, 'unsupported_media_type', 'JSON required'));
      if (Number(req.headers['content-length'] || 0) > limit) { res.setHeader('Connection', 'close'); return reject(new HttpError(413, 'payload_too_large', 'Payload too large')); }
      const chunks = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > limit) { res.setHeader('Connection', 'close'); req.removeAllListeners('data'); reject(new HttpError(413, 'payload_too_large', 'Payload too large')); } else chunks.push(c); });
      req.on('end', () => {
        try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw 0; resolve(v); }
        catch { reject(new HttpError(400, 'invalid_json', 'Invalid JSON body')); }
      });
      req.on('error', () => reject(new HttpError(400, 'invalid_request', 'Bad request')));
    });
  }

  function send(res, status, json, extraHeaders = {}) {
    if (res.writableEnded) return;
    if (status === 204 || json === undefined) { res.writeHead(status, extraHeaders); return res.end(); }
    const body = JSON.stringify(json);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...extraHeaders });
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    const t0 = now(), reqId = crypto.randomUUID(), ip = clientIp(req);
    const url = new URL(req.url, 'http://local');
    let status = 500;
    res.setHeader('X-Request-Id', reqId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    if (cfg.prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = req.headers.origin;
    if (origin && cfg.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    try {
      if (req.method === 'OPTIONS') { status = 204; return send(res, 204); }
      const wait = limiter.hit(`gen:${ip}`, cfg.generalRateLimit);
      if (wait) throw new HttpError(429, 'rate_limited', 'Too many requests', { retryAfter: wait });
      const r = routes.get(`${req.method} ${url.pathname}`);
      if (!r) throw paths.has(url.pathname) ? new HttpError(405, 'method_not_allowed', 'Method not allowed') : new HttpError(404, 'not_found', 'Not found');
      if (r.opts.authLimit) {
        const w = limiter.hit(`auth:${ip}`, cfg.authRateLimit);
        if (w) throw new HttpError(429, 'rate_limited', 'Too many requests', { retryAfter: w });
      }
      let user = null;
      if (r.opts.auth) {
        const m = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(String(req.headers.authorization || ''));
        const claims = m && sec.verifyAccess(m[1]);
        user = claims && db.prepare('SELECT id,username,role FROM users WHERE id=?').get(claims.sub);
        if (!user) throw new HttpError(401, 'unauthorized', 'Authentication required');
      }
      const body = r.opts.body ? await readJson(req, res, r.opts.body) : {};
      const out = await r.fn({ req, body, user, ip });
      status = out.status;
      send(res, status, out.json);
    } catch (e) {
      if (e instanceof HttpError) {
        status = e.status;
        const { retryAfter, ...rest } = e.extra;
        send(res, status, { error: { code: e.code, message: e.message, ...rest } }, retryAfter ? { 'Retry-After': String(retryAfter) } : {});
      } else {
        status = 500; log('error', 'unhandled', { reqId, name: e?.name, code: e?.code }); // no message/stack: may contain user data
        send(res, 500, { error: { code: 'internal', message: 'Internal error', requestId: reqId } });
      }
    } finally {
      log('info', 'request', { reqId, method: req.method, path: url.pathname, status, ms: now() - t0 });
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000;

  return { server, db, close: () => new Promise(r => { limiter.stop(); server.close(() => { db.close(); r(); }); server.closeAllConnections?.(); }) };
}
