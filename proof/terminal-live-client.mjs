import { Effect } from "effect";
import WebSocket from "ws";
import { runTerminalLiveProof } from "./terminal-live-client-program.mjs";
import { terminalSocketLayer } from "./terminal-socket.mjs";

const host = process.env.MYAX_HOST;
const token = process.env.MYAX_TOKEN;
const canary = process.env.MYAX_CANARY;
if (!host || !token || !canary) {
  console.error("FAIL: MYAX_HOST, MYAX_TOKEN and MYAX_CANARY are required");
  process.exit(1);
}

const outcome = await Effect.runPromise(
  runTerminalLiveProof({ host, token, canary }).pipe(
    Effect.provide(terminalSocketLayer((url, options) => new WebSocket(url, options))),
    Effect.match({
      onFailure: (error) => ({
        ok: false,
        reason: error?._tag === "TerminalLiveError" ? error.reason : "the live pty proof exceeded its budget",
        checks: [],
      }),
      onSuccess: (result) => ({ ok: result.failures.length === 0, checks: result.checks, failures: result.failures }),
    }),
  ),
);

for (const check of outcome.checks) console.log(`${check.ok ? "ok" : "FAIL"}: ${check.label}`);
if (!outcome.ok) {
  if ("reason" in outcome) console.error(`FAIL: ${outcome.reason}`);
  else console.error(`FAIL: ${outcome.failures.length} live pty assertion(s) failed`);
  process.exit(1);
}
console.log("ok: the live pty proved typing, resize, and reconnect survival");
