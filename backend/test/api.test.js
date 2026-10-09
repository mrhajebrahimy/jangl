import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';

const cfg = { prod: false, host: '127.0.0.1', port: 0, dbPath: ':memory:', jwtSecret: 'x'.repeat(48), allowedOrigins: ['https://ok.example'],
  trustProxy: false, scryptN: 1024, accessTtl: 900, refreshTtlDays: 30, authRateLimit: 1000, generalRateLimit: 10000 };
let app, base;
const api = async (method, path, { body, token, headers } = {}) => {
  const r = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null, headers: r.headers };
};
const reg = (u, p = 'Str0ng-pass!') => api('POST', '/api/auth/register', { body: { username: u, password: p } });

before(async () => { app = createApp(cfg); await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${app.server.address().port}`; });
after(() => app.close());

test('health', async () => { assert.equal((await api('GET', '/healthz')).json.status, 'ok'); });

test('register, me, no plaintext password in DB', async () => {
  const r = await reg('alice');
  assert.equal(r.status, 201);
  const me = await api('GET', '/api/me', { token: r.json.accessToken });
  assert.equal(me.json.username, 'alice'); assert.equal(me.json.role, 'learner');
  const row = app.db.prepare('SELECT pw_hash FROM users WHERE username_norm=?').get('alice');
  assert.ok(row.pw_hash.startsWith('scrypt$') && !row.pw_hash.includes('Str0ng'));
});

test('input validation', async () => {
  assert.equal((await reg('a')).json.error.code, 'invalid_username');
  assert.equal((await reg('bad name!')).json.error.code, 'invalid_username');
  assert.equal((await reg('shortpw', 'short')).json.error.code, 'invalid_password');
  assert.equal((await reg('sameuser1', 'sameuser1')).json.error.code, 'weak_password');
  assert.equal((await reg('two  spaces')).json.error.code, 'invalid_username');
  assert.equal((await reg(' lead')).status, 201); // trimmed to 'lead'
  assert.equal((await reg('javad hajebrahimy', 'javad4085')).status, 201);
  assert.equal((await reg('Javad Hajebrahimy', 'javad4085')).status, 409);
  assert.equal((await reg('Alice')).status, 409); // case-insensitive uniqueness
  assert.equal((await reg('__proto__')).status, 201); // no prototype pollution issues
});

test('login: generic errors, lockout', async () => {
  await reg('bob');
  const bad = await api('POST', '/api/auth/login', { body: { username: 'bob', password: 'wrong-pass-1' } });
  const none = await api('POST', '/api/auth/login', { body: { username: 'ghost', password: 'wrong-pass-1' } });
  assert.deepEqual(bad.json, none.json); assert.equal(bad.status, 401);
  for (let i = 0; i < 4; i++) await api('POST', '/api/auth/login', { body: { username: 'bob', password: 'nope-nope-' + i } });
  const locked = await api('POST', '/api/auth/login', { body: { username: 'bob', password: 'Str0ng-pass!' } });
  assert.equal(locked.status, 429); assert.ok(locked.headers.get('retry-after'));
});

test('refresh rotation + reuse detection', async () => {
  const r = (await reg('carol')).json;
  const r2 = await api('POST', '/api/auth/refresh', { body: { refreshToken: r.refreshToken } });
  assert.equal(r2.status, 200); assert.notEqual(r2.json.refreshToken, r.refreshToken);
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: r.refreshToken } })).status, 401); // reuse
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: r2.json.refreshToken } })).status, 401); // family revoked
});

test('logout revokes refresh token', async () => {
  const r = (await reg('dave')).json;
  assert.equal((await api('POST', '/api/auth/logout', { body: { refreshToken: r.refreshToken } })).status, 204);
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: r.refreshToken } })).status, 401);
});

test('token tampering, alg:none, expiry, missing token', async () => {
  const r = (await reg('erin')).json;
  const [h, b, s] = r.accessToken.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url')), role: 'admin' })).toString('base64url');
  assert.equal((await api('GET', '/api/me', { token: `${h}.${forged}.${s}` })).status, 401);
  const none = Buffer.from('{"alg":"none"}').toString('base64url');
  assert.equal((await api('GET', '/api/me', { token: `${none}.${b}.${s}` })).status, 401);
  const exp = Buffer.from(JSON.stringify({ sub: 'x', exp: 1 })).toString('base64url');
  const sig = crypto.createHmac('sha256', cfg.jwtSecret).update(`${h}.${exp}`).digest('base64url');
  assert.equal((await api('GET', '/api/me', { token: `${h}.${exp}.${sig}` })).status, 401);
  assert.equal((await api('GET', '/api/me')).status, 401);
});

test('state: versioning, conflicts, per-user isolation', async () => {
  const a = (await reg('frank')).json, b = (await reg('grace')).json;
  assert.deepEqual((await api('GET', '/api/state', { token: a.accessToken })).json, { version: 0, updatedAt: 0, state: null });
  const p1 = await api('PUT', '/api/state', { token: a.accessToken, body: { baseVersion: 0, state: { xpBanked: 500 } } });
  assert.equal(p1.json.version, 1);
  const stale = await api('PUT', '/api/state', { token: a.accessToken, body: { baseVersion: 0, state: { xpBanked: 1 } } });
  assert.equal(stale.status, 409); assert.equal(stale.json.error.state.xpBanked, 500);
  assert.equal((await api('GET', '/api/state', { token: b.accessToken })).json.state, null); // grace sees nothing of frank
  assert.equal((await api('PUT', '/api/state', { token: a.accessToken, body: { baseVersion: 1, state: [1] } })).status, 400);
});

test('payload limits, content-type, malformed JSON, no info leak', async () => {
  const a = (await reg('heidi')).json;
  const big = await api('PUT', '/api/state', { token: a.accessToken, body: { baseVersion: 0, state: { x: 'a'.repeat(3.2 * 1024 * 1024) } } });
  assert.equal(big.status, 413);
  const ct = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(ct.status, 415);
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  const t = await bad.text(); assert.equal(bad.status, 400); assert.ok(!/at |node:|stack/i.test(t));
  assert.equal((await api('GET', '/nope')).status, 404);
  assert.equal((await api('GET', '/api/auth/login')).status, 405);
});

test('CORS allowlist and security headers', async () => {
  const ok = await api('GET', '/healthz', { headers: { Origin: 'https://ok.example' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://ok.example');
  const evil = await api('GET', '/healthz', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('account deletion removes all data', async () => {
  const a = (await reg('ivan')).json;
  await api('PUT', '/api/state', { token: a.accessToken, body: { baseVersion: 0, state: { k: 1 } } });
  assert.equal((await api('DELETE', '/api/account', { token: a.accessToken, body: { password: 'wrong-wrong' } })).status, 403);
  assert.equal((await api('DELETE', '/api/account', { token: a.accessToken, body: { password: 'Str0ng-pass!' } })).status, 204);
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM user_state WHERE user_id=?').get(a.user.id).c, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM refresh_tokens WHERE user_id=?').get(a.user.id).c, 0);
  assert.equal((await api('GET', '/api/me', { token: a.accessToken })).status, 401);
});

test('auth endpoints are rate limited', async () => {
  const app2 = createApp({ ...cfg, authRateLimit: 3 });
  await new Promise(r => app2.server.listen(0, '127.0.0.1', r));
  const u = `http://127.0.0.1:${app2.server.address().port}/api/auth/login`;
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'x', password: 'y' }) })).status);
  assert.deepEqual(codes.slice(3), [429, 429]);
  await app2.close();
});
