import assert from "node:assert/strict";
import fs from "node:fs";

const layout = fs.readFileSync("src/views/Layout.tsx", "utf8");
const chat = fs.readFileSync("proof/svelte/Chat.svelte", "utf8");
const index = fs.readFileSync("src/index.tsx", "utf8");

assert.match(index, /app\.get\("\/api\/version"/);
assert.match(index, /deploymentVersionResponse/);
assert.match(layout, /900000/);
assert.match(layout, /visibilitychange/);
assert.match(layout, /X-My-Ax-Version-Timestamp/);
assert.match(layout, /my-ax:deploy-update/);
assert.match(chat, /event\.preventDefault\(\)/);
assert.match(chat, /DEPLOY_REFRESH_DRAFT_KEY/);
assert.match(chat, /wsState\.status !== "idle"/);
assert.match(chat, /voiceEnabled \|\| voiceStarting/);
console.log("deploy refresh source contract: ok");
