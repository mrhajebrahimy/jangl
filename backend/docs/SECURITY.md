# Security notes

## Architecture
```
[Android WebView / PWA]  --HTTPS+Bearer-->  [Reverse proxy TLS]  -->  [Node API]  -->  [SQLite (WAL)]
   local state (offline-first)                                       scrypt, HS256 JWT 15 min,
   debounced sync, version check                                     rotating refresh tokens
```
## Threat model (STRIDE, short)
| Threat | Control |
|---|---|
| Credential stuffing / brute force | per-IP rate limit, per-account exponential lockout, generic login errors, timing equalised for unknown users |
| Password DB leak | scrypt (N=2^17, r=8, p=1, per-user salt); hash params stored, rehash on login when raised |
| Stolen refresh token | rotation on every use; reuse of an old token revokes the whole family; stored only as SHA-256 |
| Forged/tampered JWT | HMAC-SHA256 only, `alg` pinned, constant-time compare, `exp` enforced, user re-checked in DB |
| IDOR / privilege escalation | user id comes only from the verified token; no endpoint takes a user id; role cannot be set via API |
| Injection | prepared statements only; strict type validation; no HTML produced by the API |
| DoS | body caps, request timeouts, scrypt concurrency cap (2), rate limits |
| Info leak | uniform JSON errors, no stacks, logs never contain bodies/tokens/passwords, IPs stored as keyed hash |
| CSRF / CORS | Bearer tokens (no cookies), exact-origin CORS allowlist |

## OWASP checklist (✔ done · ◐ partial · ✘ not done)
✔ password hashing · ✔ short-lived access token · ✔ refresh rotation + reuse detection · ✔ rate limiting + lockout · ✔ input validation · ✔ security headers · ✔ audit log (no secrets) · ✔ migrations/constraints/transactions · ✔ health check · ✔ structured logs · ✔ non-root container · ◐ MASVS storage (tokens in WebView localStorage, app-private, not Keystore-encrypted) · ◐ pinning (none: CDN/host certs rotate; use pinning only on your own API domain via Network Security Config once the domain is fixed) · ✘ email verification / password reset · ✘ crash reporting/monitoring backend · ✘ admin endpoints (role column exists, none exposed).

## Known limitations
- **scrypt, not Argon2id**: Node 22 has no built-in Argon2. scrypt at these parameters is OWASP-accepted; hashes self-describe so migrating later is a rehash-on-login.
- `node:sqlite` is marked experimental in Node 22; the tests pass but pin the Node version and consider `better-sqlite3` for long-term production.
- Access tokens can't be revoked before their 15-minute expiry (stateless). Logout revokes refresh tokens immediately.
- Rate limiter is in-memory: single instance only. Registration is open to anyone.
- No password recovery: needs an email/SMS provider.
- Concurrent edits from two devices: last writer wins after a version conflict.
- Client CSP still needs `'unsafe-inline'` (the app has inline scripts) and loads three.js/fonts from CDNs without SRI.
