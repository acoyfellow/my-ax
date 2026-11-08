#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
jar=${TLA2TOOLS:-$HOME/cloudflare/.context/tla/tla2tools.jar}
java=${JAVA:-/opt/homebrew/opt/openjdk/bin/java}
node --import tsx "$here/gen-tables.ts"
status=0
for spec in "$@"; do
  out=$("$java" -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers 1 -deadlock -config "$here/$spec.cfg" "$here/$spec.tla" -metadir "$here/.tlc/$spec" 2>&1) || true
  if printf '%s' "$out" | grep -q "Model checking completed. No error has been found."; then
    states=$(printf '%s' "$out" | sed -n 's/.* \([0-9]*\) distinct states found.*/\1/p' | tail -1)
    echo "PASS $spec ($states distinct states)"
  else
    echo "FAIL $spec"
    printf '%s\n' "$out" | sed -n '/Error:/,/^Finished/p' | grep -v "^Starting\|^Finished" | head -60
    status=1
  fi
done
exit $status
