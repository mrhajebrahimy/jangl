import crypto from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');
const MAXMEM = 256 * 1024 * 1024;

export function createSecurity(cfg) {
  // Limit concurrent scrypt jobs (each uses ~128 MB at N=2^17) to avoid memory-exhaustion DoS.
  let active = 0; const queue = [];
  const acquire = () => new Promise(res => { if (active < 2) { active++; res(); } else queue.push(res); });
  const release = () => { const n = queue.shift(); if (n) n(); else active--; };

  const scrypt = (pw, salt, N, r, p) => new Promise((res, rej) =>
    crypto.scrypt(pw, salt, 32, { N, r, p, maxmem: MAXMEM }, (e, k) => (e ? rej(e) : res(k))));

  async function hashPassword(password) {
    const salt = crypto.randomBytes(16), N = cfg.scryptN, r = 8, p = 1;
    await acquire();
    try { const k = await scrypt(password.normalize('NFKC'), salt, N, r, p); return `scrypt$${N}$${r}$${p}$${b64u(salt)}$${b64u(k)}`; }
    finally { release(); }
  }
  async function verifyPassword(password, stored) {
    const [alg, N, r, p, s, h] = String(stored).split('$');
    if (alg !== 'scrypt' || !h) return { ok: false, rehash: false };
    await acquire();
    try {
      const k = await scrypt(password.normalize('NFKC'), Buffer.from(s, 'base64url'), +N, +r, +p);
      const want = Buffer.from(h, 'base64url');
      return { ok: k.length === want.length && crypto.timingSafeEqual(k, want), rehash: +N < cfg.scryptN };
    } finally { release(); }
  }
  let dummy;
  const dummyVerify = async pw => { dummy ??= await hashPassword('timing-equaliser-not-a-real-password'); await verifyPassword(pw, dummy); };

  const sign = data => crypto.createHmac('sha256', cfg.jwtSecret).update(data).digest('base64url');
  function signAccess(user) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64u(JSON.stringify({ sub: user.id, role: user.role, iat: now, exp: now + cfg.accessTtl }));
    return `${head}.${body}.${sign(`${head}.${body}`)}`;
  }
  function verifyAccess(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, b, s] = parts;
    try {
      if (JSON.parse(Buffer.from(h, 'base64url')).alg !== 'HS256') return null; // rejects alg:none & confusion
      const a = Buffer.from(s), e = Buffer.from(sign(`${h}.${b}`));
      if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
      const claims = JSON.parse(Buffer.from(b, 'base64url'));
      return typeof claims.exp === 'number' && claims.exp > Date.now() / 1000 && typeof claims.sub === 'string' ? claims : null;
    } catch { return null; }
  }
  const newRefreshToken = () => crypto.randomBytes(32).toString('base64url');
  const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
  const ipHash = ip => crypto.createHmac('sha256', cfg.jwtSecret).update(String(ip)).digest('hex').slice(0, 16);

  return { hashPassword, verifyPassword, dummyVerify, signAccess, verifyAccess, newRefreshToken, hashToken, ipHash };
}
