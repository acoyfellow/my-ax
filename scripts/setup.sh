#!/usr/bin/env bash
# my-ax — one-command setup + deploy on your own Cloudflare account.
#
#   npx wrangler login      # once, browser OAuth — no API token needed
#   bash scripts/setup.sh
#
# Creates the D1 database, KV namespace, and R2 buckets; writes their ids
# back into wrangler.jsonc; generates the two required secrets; applies D1
# migrations; and deploys. Re-running resolves existing resources and preserves
# durable secrets.
#
# Models default to Workers AI (no keys). Production requests remain locked
# until Cloudflare Access issuer/audience values are configured.
set -euo pipefail

WRANGLER="npx wrangler"
CFG="wrangler.jsonc"

# Wrangler OAuth can expose more than one account. Pinning avoids creating
# resources in one account and deploying the Worker to another.
if [ -n "${MY_AX_ACCOUNT_ID:-}" ]; then
  export CLOUDFLARE_ACCOUNT_ID="$MY_AX_ACCOUNT_ID"
fi

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
note() { printf "  %s\n" "$1"; }

bold "my-ax setup → your Cloudflare account"
note "Using your wrangler login (run 'npx wrangler login' first if needed)."
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  note "Pinned account: $CLOUDFLARE_ACCOUNT_ID"
else
  note "Account is not pinned. If 'wrangler whoami' lists multiple accounts, stop and rerun with MY_AX_ACCOUNT_ID=<id>."
fi
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
value = os.environ["VALUE"]
if placeholder not in text:
    if value in text:
        raise SystemExit(0)
    raise SystemExit(f"placeholder not found and current resource id differs: {placeholder}")
path.write_text(text.replace(placeholder, value, 1))
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

# --- fresh Durable Object baseline -------------------------------------------
# `wrangler secret put` creates an empty Worker when none exists. Replaying the
# repository's historical add/delete migration chain against that empty script
# then fails on classes which never existed there. A fresh installation needs
# one baseline containing only classes exported by the current source. Existing
# deployments retain the full append-only migration history.
if ! $WRANGLER deployments list --name my-ax >/dev/null 2>&1; then
  bold "Fresh install  Durable Object baseline"
  python3 - "$CFG" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
start = text.index('  "migrations": [')
end = text.index('\n  ],', start) + 5
base = '''  "migrations": [
    { "tag": "fresh-v1", "new_sqlite_classes": ["MyAgent", "OAuthClientDO", "Sandbox", "MachineHost", "UserAgent", "VoiceThinkAgent"] }
  ],'''
path.write_text(text[:start] + base + text[end:])
PY
  note "Collapsed historical DO migrations to a fresh-install baseline."
fi

# --- secrets -----------------------------------------------------------------
bold "4/5  Core secrets"
secret_exists() {
  local name="$1" listing
  listing="$($WRANGLER secret list --format json 2>/dev/null || printf '[]')"
  printf '%s' "$listing" \
    | NAME="$name" python3 -c 'import json,os,sys; data=json.load(sys.stdin); raise SystemExit(0 if any(row.get("name")==os.environ["NAME"] for row in data) else 1)'
}
ensure_secret() {
  local name="$1"
  if secret_exists "$name"; then
    note "$name already exists; preserving it."
    return
  fi
  command -v openssl >/dev/null 2>&1 || {
    note "openssl not found — set $name manually with: npx wrangler secret put $name"
    return 1
  }
  printf '%s' "$(openssl rand -hex 32)" | $WRANGLER secret put "$name"
  note "$name generated."
}
ensure_secret BRIDGE_JWT_SECRET
ensure_secret MASTER_KEY

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
