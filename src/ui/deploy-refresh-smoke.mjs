import assert from "node:assert/strict";
import fs from "node:fs";

const layout = fs.readFileSync("src/views/Layout.tsx", "utf8");
const chat = fs.readFileSync("src/ui/Chat.svelte", "utf8");
const index = fs.readFileSync("src/index.tsx", "utf8");

assert.match(index, /app\.get\("\/api\/version"/);
assert.match(index, /deploymentVersionResponse/);

{
  const versionAt = index.indexOf('app.get("/api/version"');
  const apiGateAt = index.indexOf('app.use("/api/*", accessMiddleware())');
  assert.ok(versionAt >= 0 && apiGateAt >= 0, "both /api/version and the /api/* access gate must exist");
  assert.ok(
    versionAt < apiGateAt,
    "REGRESSION: /api/version must be registered BEFORE app.use('/api/*', accessMiddleware()); if gated, an expired-Access PWA poll 302s to login and the installed app never detects a new deploy (frozen on old build across close/reopen).",
  );
}
assert.match(layout, /900000/);
assert.match(layout, /visibilitychange/);
assert.match(layout, /X-My-Ax-Version-Timestamp/);
assert.match(layout, /my-ax:deploy-update/);
assert.match(chat, /event\.preventDefault\(\)/);
assert.match(chat, /DEPLOY_REFRESH_DRAFT_KEY/);
assert.match(chat, /wsState\.status !== "idle"/);
assert.match(chat, /voiceEnabled \|\| voiceStarting/);
console.log("deploy refresh source contract: ok");
