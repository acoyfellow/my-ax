import { Effect } from "effect";
import WebSocket from "ws";
import { terminalSocketLayer } from "./terminal-socket.mjs";
import { runTerminalUpgradeProbe } from "./terminal-upgrade-probe-program.mjs";

const host = process.env.MYAX_HOST;
const token = process.env.MYAX_TOKEN;
if (!host || !token) {
  console.error("FAIL: MYAX_HOST and MYAX_TOKEN are required");
  process.exit(1);
}

const outcome = await Effect.runPromise(
  runTerminalUpgradeProbe({ host, token }).pipe(
    Effect.provide(terminalSocketLayer((url, options) => new WebSocket(url, options))),
    Effect.match({
      onFailure: (error) => ({
        ok: false,
        reason: error?._tag === "TerminalUpgradeError" ? error.reason : "the terminal endpoint never upgraded",
      }),
      onSuccess: (summary) => ({ ok: true, summary }),
    }),
  ),
);

if (!outcome.ok) {
  console.error(`FAIL: ${outcome.reason}`);
  process.exit(1);
}
console.log(`ok: ${outcome.summary}`);
