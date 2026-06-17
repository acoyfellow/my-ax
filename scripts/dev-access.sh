#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-worker}"
PORT="${MY_AX_LOCAL_PORT:-8788}"
# Cloudflare Access local-dev knobs. ORIGIN is the tunnel hostname Access
# points at; AUD + ISS are pulled from the Access app you fronted it with.
# All required — there are no defaults baked into the public repo.
ORIGIN="${MY_AX_LOCAL_ACCESS_ORIGIN:-}"
TUNNEL="${MY_AX_LOCAL_TUNNEL:-my-ax-local}"
AUD="${MY_AX_LOCAL_ACCESS_AUD:-}"
ISS="${MY_AX_LOCAL_ACCESS_ISS:-}"

if [[ -z "$ORIGIN" || -z "$AUD" || -z "$ISS" ]]; then
  echo "MY_AX_LOCAL_ACCESS_ORIGIN, MY_AX_LOCAL_ACCESS_AUD, and MY_AX_LOCAL_ACCESS_ISS must all be set" >&2
  echo "(see docs/local-development.md for the local-Access setup)" >&2
  exit 2
fi

case "$ORIGIN" in
  https://*) ;;
  *) echo "MY_AX_LOCAL_ACCESS_ORIGIN must be an https origin" >&2; exit 2 ;;
esac
ORIGIN_HOST="${ORIGIN#https://}"
if [[ -z "$ORIGIN_HOST" || "$ORIGIN_HOST" == */* ]]; then
  echo "MY_AX_LOCAL_ACCESS_ORIGIN must be an https origin without a path" >&2
  exit 2
fi

case "$MODE" in
  worker)
    npm run build:assets
    exec npx wrangler dev --env dev --port "$PORT" \
      --var "ENVIRONMENT:local-access" \
      --var "CF_ACCESS_AUD:$AUD" \
      --var "CF_ACCESS_ISS:$ISS" \
      --var "BRIDGE_BASE_URL:$ORIGIN"
    ;;
  tunnel)
    exec cloudflared tunnel --url "http://localhost:$PORT" run "$TUNNEL"
    ;;
  *)
    echo "usage: $0 {worker|tunnel}" >&2
    exit 2
    ;;
esac
