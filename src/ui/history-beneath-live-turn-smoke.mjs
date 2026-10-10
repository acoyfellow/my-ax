import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/sessions.ts", import.meta.url), "utf8");

assert.match(routes, /app\.get\("\/api\/sessions\/:id\/transcript"/);
assert.match(chat, /cf_agent_stream_resuming[\s\S]{0,600}loadHistoryBeneathLiveTurn\(currentSessionId\(\)\)/);
assert.match(chat, /renderThinkHistory\(earlierTurnsOnly\(body\.result\.messages\), \{ beneathLiveTurn: true \}\)/);
console.log("history-beneath-live-turn smoke ok");
assert.match(chat, /rememberActiveTurn\(m\.id, "remote-client"\);\s*dispatchTurn\(\{ type: "adopt", requestId: m\.id \}\)/);
assert.match(chat, /activeRequestId = requestId;\s*dispatchTurn\(\{ type: "server-resumable", requestId \}\)/);
assert.match(chat, /if \(progressEligible\(turnState\) \|\| piBusy \|\| sessionTurnLocksComposer\(remoteTurn\)\) showThinking\(\)/);
console.log("thinking state follows turns from other tabs ok");
assert.match(chat, /if \(agentIsBusy\(\) && ws\) \{\s*if \(composerText\.trim\(\)\) queueComposerText\(\);/);
assert.match(chat, /aria-label="Queued messages"/);
assert.match(chat, /shouldRecallQueue\(\{ key: e\.key/);
console.log("local queue wiring ok");
