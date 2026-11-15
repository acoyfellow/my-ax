#!/bin/sh
set -u
ROOT=/Users/jcoeyman/cloudflare/my-ax
STATE=/Users/jcoeyman/cloudflare/my-ax/.wrangler/complex-state
PORT=${LOCAL_DEV_PORT:-8799}
LOG=/Users/jcoeyman/cloudflare/my-ax/.git/local-dev.out
cd "$ROOT" || exit 1
case "${1:-start}" in
  start)
    npm run build:assets >"$LOG" 2>&1 || { echo "build failed, see $LOG"; exit 1; }
    npx wrangler d1 migrations apply my-ax-db-dev --local --env dev --persist-to "$STATE" >>"$LOG" 2>&1 || { echo "migrate failed, see $LOG"; exit 1; }
    nohup npx wrangler dev --env dev --port "$PORT" --persist-to "$STATE" --enable-containers=false \
      --var DEV_USER_EMAIL:dev@localhost --var "BRIDGE_BASE_URL:http://127.0.0.1:$PORT" >>"$LOG" 2>&1 &
    echo "$!" >/Users/jcoeyman/cloudflare/my-ax/.git/local-dev.pid
    i=0
    while [ $i -lt 40 ]; do
      if curl -sS -m 3 -o /dev/null "http://127.0.0.1:$PORT/api/version" 2>/dev/null; then echo "local dev up on $PORT"; exit 0; fi
      sleep 2; i=$((i + 1))
    done
    echo "local dev did not come up, see $LOG"; exit 1
    ;;
  stop)
    pkill -f "wrangler dev --env dev --port $PORT" 2>/dev/null
    rm -f /Users/jcoeyman/cloudflare/my-ax/.git/local-dev.pid
    rm -rf /Users/jcoeyman/cloudflare/my-ax/.wrangler/complex-state
    echo "local dev stopped and state removed"
    ;;
esac
