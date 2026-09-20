#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
test -f Dockerfile.computer
test -f src/named-computer.ts
npx tsx --test src/computer-id.test.ts src/named-computer-wiring.test.ts
MAX_BYTES=$((400 * 1024 * 1024))
if ! command -v docker >/dev/null; then
  echo "FAIL: docker is required to measure computer image layers"
  exit 1
fi
docker build -f Dockerfile.computer -t my-ax-computer-ci .
python3 - "$MAX_BYTES" <<'PY'
import json, subprocess, sys
max_bytes = int(sys.argv[1])
raw = subprocess.check_output(["docker", "history", "--no-trunc", "--format", "{{json .}}", "my-ax-computer-ci"], text=True)
fat = []
for line in raw.splitlines():
    row = json.loads(line)
    size = str(row.get("Size") or "0")
    created = str(row.get("CreatedBy") or row.get("CreatedBy") or "")[:80]
    bytes_ = 0
    if size.endswith("GB"):
        bytes_ = int(float(size[:-2]) * 1024 * 1024 * 1024)
    elif size.endswith("MB"):
        bytes_ = int(float(size[:-2]) * 1024 * 1024)
    elif size.endswith("kB") or size.endswith("KB"):
        bytes_ = int(float(size[:-2]) * 1024)
    elif size.endswith("B"):
        try:
            bytes_ = int(float(size[:-1]))
        except ValueError:
            bytes_ = 0
    if bytes_ >= max_bytes:
        fat.append((bytes_, created, size))
if fat:
    print("FAIL: computer image has fat layers")
    for bytes_, created, size in fat:
        print(f"  {size} {created}")
    sys.exit(1)
print("PASS: computer image layers under 400MB")
PY
echo "PASS: named computer wiring + layer budget"
