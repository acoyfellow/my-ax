#!/bin/sh
set -u
cd "$(dirname "$0")/.."
fail=0
say() { printf '%s %s\n' "$1" "$2"; }

if [ "${SKIP_CHECK:-0}" = "1" ]; then
  say SKIP "npm run check"
elif npm run check >.git/alchemy-gate-check.out 2>&1; then
  say PASS "npm run check"
else
  say FAIL "npm run check (see .git/alchemy-gate-check.out)"; fail=1
fi

for pair in job-status:Job session-status:Session run-status:Run recipe-status:Recipe attention-item:Attention; do
  fsm=${pair%%:*}; agg=${pair##*:}
  if [ -f "src/domain/$agg/$agg.aggregate.ts" ] && [ -f "src/domain/$agg/$agg.story.test.ts" ] && grep -q "src/domain/$agg/$agg.story.test.ts" package.json; then
    say PASS "aggregate $agg for src/fsm/$fsm.ts"
  else
    say FAIL "aggregate $agg for src/fsm/$fsm.ts"; fail=1
  fi
done

coverage=$(node scripts/domain-coverage.mjs 2>&1)
if [ $? -eq 0 ]; then
  say PASS "$coverage"
else
  say FAIL "$(printf '%s' "$coverage" | tr '\n' ' ')"; fail=1
fi

leaks=$(grep -rnE "UPDATE (jobs|sessions|runs|saved_recipes|attention_items) SET[^;]*status" src --include=*.ts \
  | grep -v "^src/domain/" | grep -v "\.test\.ts:" || true)
if [ -z "$leaks" ]; then
  say PASS "no status-changing SQL outside src/domain"
else
  say FAIL "status-changing SQL outside src/domain: $(printf '%s\n' "$leaks" | wc -l | tr -d ' ') sites"; fail=1
fi

if [ -f alchemy.run.ts ] && [ -n "${PREVIEW_URL:-}" ] && [ -n "${EXPECT_VERSION:-}" ] \
  && curl -fsS -m 20 "$PREVIEW_URL/api/version" | grep -q "$EXPECT_VERSION"; then
  say PASS "preview from alchemy.run.ts serves $EXPECT_VERSION"
else
  say FAIL "preview deploy from alchemy.run.ts"; fail=1
fi

exit $fail
