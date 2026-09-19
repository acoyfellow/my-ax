#!/usr/bin/env bash
set -euo pipefail
RECEIPT="${FACTORY_FANOUT_RECEIPT:-/tmp/factory-fanout-receipt.json}"
if [[ ! -f "$RECEIPT" ]]; then
  echo "FAIL: no receipt at $RECEIPT"
  exit 1
fi
python3 - "$RECEIPT" <<'PY'
import json, re, sys
path = sys.argv[1]
data = json.load(open(path))
titles = data.get("issueTitles") or []
machine = int(data.get("machineWhere") or 0)
ok_titles = [t for t in titles if re.match(r"^Issue #\d+:", str(t))]
if machine != 0:
    print(f"FAIL: machine where={machine}")
    sys.exit(1)
if not ok_titles:
    print("FAIL: no Issue #<n>: session titles")
    sys.exit(1)
print(f"PASS: titles={ok_titles} machineWhere=0")
PY
