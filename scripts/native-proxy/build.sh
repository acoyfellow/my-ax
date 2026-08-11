#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
scriptc coverage proxy.ts
scriptc build proxy.ts -o my-ax-mcp-proxy
