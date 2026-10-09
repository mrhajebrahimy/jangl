#!/bin/sh
# Usage: scripts/configure-web.sh https://api.example.com [www_dir]
# Points the client at the backend: writes config.js and allows that origin in the CSP (connect-src).
set -eu
API="${1:-}"; WWW="${2:-app/src/main/assets/www}"
echo "$API" | grep -Eq '^(https://[A-Za-z0-9.-]+(:[0-9]+)?|http://(127\.0\.0\.1|localhost)(:[0-9]+)?)$' \
  || { echo "API URL must be https://host[:port] (http only for localhost)" >&2; exit 1; }
printf 'window.ARIA_API_BASE = "%s";\n' "$API" > "$WWW/config.js"
grep -q "connect-src 'self' $API" "$WWW/index.html" || sed -i "s#connect-src 'self'#connect-src 'self' $API#" "$WWW/index.html"
echo "configured $WWW for $API"
