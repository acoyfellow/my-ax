#!/usr/bin/env bash
# my-ax — one-command setup + deploy on your own Cloudflare account.
#
#   npx wrangler login      # once, browser OAuth — no API token needed
#   bash scripts/setup.sh
#
# Creates the D1 database, KV namespace, and R2 buckets; writes their ids
# back into wrangler.jsonc; generates the two required secrets; applies D1
# migrations; and deploys. Idempotent-ish: re-running re-creates only what's
# missing (Cloudflare returns the existing id for names that already exist).
#
# Models default to Workers AI (no keys). Production requests remain locked
# until Cloudflare Access issuer/audience values are configured.
set -euo pipefail

WRANGLER="npx wrangler"
CFG="wrangler.jsonc"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
note() { printf "  %s\n" "$1"; }

bold "my-ax setup → your Cloudflare account"
note "Using your wrangler login (run 'npx wrangler login' first if needed)."
echo

# --- helper: extract an id from wrangler create output -----------------------
# wrangler prints the new resource id; we grab it and patch wrangler.jsonc.
patch_placeholder() { # $1=exact-placeholder $2=new-id
  PLACEHOLDER="$1" VALUE="$2" python3 - "$CFG" <<'PY'
import os, sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
placeholder = os.environ["PLACEHOLDER"]
if placeholder not in text:
    raise SystemExit(f"placeholder not found: {placeholder}")
path.write_text(text.replace(placeholder, os.environ["VALUE"], 1))
PY
}

# --- D1 ----------------------------------------------------------------------
bold "1/5  D1 database (my-ax-db)"
D1_OUT="$($WRANGLER d1 create my-ax-db 2>&1 || true)"
D1_ID="$(printf '%s' "$D1_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)"
if [ -z "$D1_ID" ]; then
  D1_ID="$($WRANGLER d1 list --json 2>/dev/null | python3 -c 'import json,sys; print(next((x["uuid"] for x in json.load(sys.stdin) if x.get("name")=="my-ax-db"), ""))' || true)"
fi
[ -n "$D1_ID" ] || { printf '%s\n' "$D1_OUT" >&2; echo "Could not create or resolve my-ax-db" >&2; exit 1; }
note "id: $D1_ID"; patch_placeholder "REPLACE_WITH_D1_DATABASE_ID" "$D1_ID"

# --- KV ----------------------------------------------------------------------
bold "2/5  KV namespace (AUDIT_KV)"
KV_OUT="$($WRANGLER kv namespace create AUDIT_KV 2>&1 || true)"
KV_ID="$(printf '%s' "$KV_OUT" | grep -oE '[0-9a-f]{32}' | head -1 || true)"
if [ -z "$KV_ID" ]; then
  KV_ID="$($WRANGLER kv namespace list 2>/dev/null | python3 -c 'import json,sys; print(next((x["id"] for x in json.load(sys.stdin) if x.get("title")=="AUDIT_KV"), ""))' || true)"
fi
[ -n "$KV_ID" ] || { printf '%s\n' "$KV_OUT" >&2; echo "Could not create or resolve AUDIT_KV" >&2; exit 1; }
note "id: $KV_ID"; patch_placeholder "REPLACE_WITH_KV_NAMESPACE_ID" "$KV_ID"

# --- R2 ----------------------------------------------------------------------
bold "3/5  R2 buckets (my-ax-homes, my-ax-uploads)"
$WRANGLER r2 bucket create my-ax-homes   2>&1 | tail -1 || $WRANGLER r2 bucket list | grep -q 'my-ax-homes'
$WRANGLER r2 bucket create my-ax-uploads 2>&1 | tail -1 || $WRANGLER r2 bucket list | grep -q 'my-ax-uploads'

# --- secrets -----------------------------------------------------------------
bold "4/5  Core secrets (auto-generated)"
if command -v openssl >/dev/null 2>&1; then
  printf '%s' "$(openssl rand -hex 32)" | $WRANGLER secret put BRIDGE_JWT_SECRET
  printf '%s' "$(openssl rand -hex 32)" | $WRANGLER secret put MASTER_KEY
  note "BRIDGE_JWT_SECRET + MASTER_KEY set."
else
  note "openssl not found — set BRIDGE_JWT_SECRET and MASTER_KEY manually:"
  note "  npx wrangler secret put BRIDGE_JWT_SECRET"
  note "  npx wrangler secret put MASTER_KEY"
fi

# --- migrate + deploy --------------------------------------------------------
bold "5/5  Migrate D1 + deploy"
$WRANGLER d1 migrations apply my-ax-db --remote
if grep -q 'REPLACE_WITH_' "$CFG"; then echo "Unresolved resource placeholders remain in $CFG" >&2; exit 1; fi
npm run deploy

echo
bold "Done."
note "Your worker is live on its *.workers.dev URL (shown above)."
note "Models: Workers AI works without provider keys; configure a model gateway for gateway-backed catalog entries."
echo
printf "\033[1m🔒 The Worker rejects production requests until Cloudflare Access is configured.\033[0m\n"
note "Create a Self-hosted Access app for the URL, set CF_ACCESS_ISS + CF_ACCESS_AUD in wrangler.jsonc, then redeploy."
note "Guide: https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/"
