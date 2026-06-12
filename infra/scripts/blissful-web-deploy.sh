#!/usr/bin/env bash
# Canonical web / thin-shell UI deploy (run on the Mac).
#
# Builds apps/web-blissful and purges the CDN cache for the PWA control
# files. The purge is REQUIRED, not optional: Cloudflare's zone Browser-Cache-
# TTL (4h) rewrites Cache-Control on sw.js even though the origin sends
# no-cache (public/serve.json), so without a purge the service worker stays
# frozen on the old bundle inside every thin-shell desktop WebView for ~4h —
# the "web updated but the desktop app didn't" bug. `serve` reads dist live,
# so a content-only change needs no container restart.
#
# Needs CLOUDFLARE_API_TOKEN (Zone.Cache Purge scope) in ~/home-lab/Blissful/.env.
set -euo pipefail

REPO="${BLISSFUL_REPO:-$HOME/home-lab/Blissful}"
ZONE_NAME="${BLISSFUL_ZONE:-budinoff.com}"
SITE="${BLISSFUL_SITE:-https://blissful.budinoff.com}"

cd "$REPO"
echo "==> git pull"
git pull --ff-only
echo "==> build"
npm --prefix apps/web-blissful run build >/dev/null
echo "    built: $(grep -oE 'index-[A-Za-z0-9_-]+\.js' apps/web-blissful/dist/index.html | head -1)"

TOKEN=$(grep -E '^CLOUDFLARE_API_TOKEN=' "$REPO/.env" 2>/dev/null | head -1 \
  | sed -E 's/^CLOUDFLARE_API_TOKEN=//; s/^["'"'"']//; s/["'"'"']$//; s/\r$//')
if [ -z "${TOKEN:-}" ]; then
  echo "WARN: no CLOUDFLARE_API_TOKEN in $REPO/.env — skipped CDN purge."
  echo "      Desktops will update within Cloudflare's ~4h Browser-Cache-TTL."
  exit 0
fi

ZONE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin).get("result") or []; print(r[0]["id"] if r else "")')
if [ -z "$ZONE" ]; then echo "WARN: could not resolve Cloudflare zone $ZONE_NAME — skipped purge."; exit 0; fi

echo "==> purge CDN (sw.js + entry points)"
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  --data "{\"files\":[\"$SITE/sw.js\",\"$SITE/registerSW.js\",\"$SITE/index.html\",\"$SITE/\",\"$SITE/manifest.webmanifest\"]}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("    purge:", "ok" if d.get("success") else d.get("errors"))'

echo "==> done. Live + every thin-shell desktop updates on its next SW check (~60s)."
