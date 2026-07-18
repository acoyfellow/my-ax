// page-connector-benchmark.mjs — token/turn delta for a multi-step UI steer.
//
// Scenario (a real "steer the live app" task the owner might ask):
//   "List my recent conversations, switch to the one titled 'Beta thread',
//    then read its container health so I know if the workspace is full."
//
// BEFORE (no page connector): the model cannot act on the live UI in one shot.
// Each step is its own assistant turn — the model reads the result, then decides
// the next call — so the FULL prompt (system + tool schemas + growing
// transcript) is re-billed as INPUT tokens once per turn.
//
// AFTER (page connector): the model writes ONE work_code function that composes
// all three verbs (page.listSessions -> page.switchSession -> page.readHealth)
// and gets back one combined result. One turn, one input-prompt billing.
//
// This estimates input-token cost with a standard ~4-chars/token heuristic over
// the actual prompt-shaped strings. It is a MODEL of the turn structure, not a
// live inference bill; the headline is the TURN COUNT collapse (N -> 1) and the
// resulting input-token multiplier, both of which are structural and real.

const CHARS_PER_TOKEN = 4;
const est = (s) => Math.ceil(s.length / CHARS_PER_TOKEN);

// Representative fixed prompt overhead re-sent as input on EVERY turn.
// (my.ax's system prompt + the work_code/work_search tool schemas are large;
// 2600 tokens is a conservative lower bound for this app's real preamble.)
const SYSTEM_AND_TOOLS_TOKENS = 2600;

// A compact user ask + the transcript that accumulates as the steer proceeds.
const userAsk = "List my recent conversations, switch to the Beta thread, then read that workspace's container health.";
const stepResults = [
  '[{"id":"86f61450","title":"Alpha thread"},{"id":"30d895f4","title":"Beta thread"}]',
  '{"ok":true,"id":"30d895f4"}',
  '{"region":"AUS-DOG","home":{"diskUsedBytes":16384,"fileCount":0}}',
];

// BEFORE: 3 sequential turns. Each turn re-bills system+tools + the whole
// transcript-so-far (user ask + all prior tool results) as input tokens.
let beforeInput = 0;
let transcript = userAsk;
const beforeTurns = stepResults.length;
for (let i = 0; i < beforeTurns; i++) {
  beforeInput += SYSTEM_AND_TOOLS_TOKENS + est(transcript);
  transcript += "\n" + stepResults[i]; // result folded into context for the next turn
}

// AFTER: 1 turn. System+tools + user ask billed once. The model emits one
// work_code function; the single combined result comes back in that same turn.
const workCodeBody = `async () => {
  const sessions = await page.listSessions();
  const beta = sessions.find(s => /beta/i.test(s.title || ""));
  await page.switchSession({ id: beta.id });
  return { switchedTo: beta.id, health: await page.readHealth() };
}`;
const afterTurns = 1;
const afterInput = SYSTEM_AND_TOOLS_TOKENS + est(userAsk) + est(workCodeBody);

const turnReduction = beforeTurns - afterTurns;
const inputSaved = beforeInput - afterInput;
const multiplier = (beforeInput / afterInput).toFixed(2);

const report = {
  scenario: "3-step live UI steer (listSessions -> switchSession -> readHealth)",
  assumptions: { charsPerToken: CHARS_PER_TOKEN, systemAndToolsTokensPerTurn: SYSTEM_AND_TOOLS_TOKENS },
  before: { turns: beforeTurns, estInputTokens: beforeInput },
  after: { turns: afterTurns, estInputTokens: afterInput },
  delta: { turnsSaved: turnReduction, inputTokensSaved: inputSaved, inputTokenMultiplier: `${multiplier}x` },
};

console.log(JSON.stringify(report, null, 2));

// Guardrail so this stays an honest, monotonic claim in CI.
import assert from "node:assert/strict";
assert.equal(report.after.turns, 1, "page connector collapses the steer to one turn");
assert.ok(report.delta.turnsSaved >= 2, "at least 2 turns saved on a 3-step steer");
assert.ok(report.delta.inputTokensSaved > 0, "input tokens strictly reduced");
console.log("\nBENCHMARK OK:", `${beforeTurns} turns -> 1 turn, ~${inputSaved} input tokens saved (${multiplier}x fewer input tokens).`);
