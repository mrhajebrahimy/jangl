# Aria Edit API

Node.js ≥ 22.5, **zero npm dependencies** (built-in `node:http`, `node:sqlite`, `node:crypto`).

## Run locally
```
cd backend
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
export ALLOWED_ORIGINS=http://127.0.0.1:8766 SCRYPT_N=16384
npm start          # http://127.0.0.1:8080/healthz
npm test
```
## Docker
```
docker build -t aria-edit-api backend
docker run -d -p 8080:8080 -v aria-data:/data --env-file backend/.env aria-edit-api
```
Put it behind a TLS-terminating reverse proxy (Caddy/nginx/Cloudflare) and set `TRUST_PROXY=true`. Never expose plain HTTP: the app forbids cleartext. Variables: see `.env.example`.

## Point the app at it
`scripts/configure-web.sh https://api.yourdomain.com` (writes `config.js`, extends CSP `connect-src`), then rebuild.
Leave `config.js` empty for the offline, device-only mode.

## Backups
SQLite file in `/data` (WAL mode). Back up with `sqlite3 aria.db ".backup out.db"`, not by copying while running.
