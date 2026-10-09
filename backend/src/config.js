export function loadConfig(env = process.env) {
  const secret = env.JWT_SECRET || '';
  if (secret.length < 32 || secret.startsWith('CHANGE_ME')) {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters');
  }
  const int = (v, d) => { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    prod: env.NODE_ENV === 'production',
    host: env.HOST || '127.0.0.1',
    port: int(env.PORT, 8080),
    dbPath: env.DB_PATH || './aria.db',
    jwtSecret: secret,
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true',
    scryptN: int(env.SCRYPT_N, 131072),
    accessTtl: int(env.ACCESS_TTL_SECONDS, 900),
    refreshTtlDays: int(env.REFRESH_TTL_DAYS, 30),
    authRateLimit: int(env.AUTH_RATE_LIMIT, 20),
    generalRateLimit: int(env.GENERAL_RATE_LIMIT, 120)
  };
}
