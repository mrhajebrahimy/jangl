# API (JSON, `Authorization: Bearer <accessToken>` where noted)

| Method & path | Auth | Body | Result |
|---|---|---|---|
| GET /healthz | – | – | 200 `{status:"ok"}` |
| POST /api/auth/register | – | `{username,password}` | 201 `{accessToken,refreshToken,expiresIn,user}` · 400 · 409 `username_taken` |
| POST /api/auth/login | – | `{username,password}` | 200 tokens · 401 generic · 429 `account_locked` (+`Retry-After`) |
| POST /api/auth/refresh | – | `{refreshToken}` | 200 new pair (old token is revoked) · 401 |
| POST /api/auth/logout | – | `{refreshToken}` | 204 (revokes the whole token family) |
| GET /api/me | ✔ | – | `{id,username,role}` |
| GET /api/state | ✔ | – | `{version,updatedAt,state}` (`state:null`, `version:0` when empty) |
| PUT /api/state | ✔ | `{baseVersion,state}` | 200 `{version}` · 409 `version_conflict` with server `version`+`state` |
| DELETE /api/account | ✔ | `{password}` | 204; deletes user, tokens, state |

Errors: `{error:{code,message}}`; 500 adds only `requestId`. Limits: 16 KB bodies (3 MB for state), 20 auth calls/min/IP, 120 requests/min/IP, lockout after 5 wrong passwords (30 s doubling, max 15 min).
Username: 3–24 of letters/digits/`_ . -` plus single spaces between words, case-insensitive unique. Password: 8–128 chars.
