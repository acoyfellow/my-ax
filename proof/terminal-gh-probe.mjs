import { Effect } from "effect";
import WebSocket from "ws";
import {
  runTerminalGhProbe,
  terminalSocketLayer,
} from "./terminal-gh-probe-program.mjs";

const host = process.env.MYAX_HOST;
const token = process.env.MYAX_TOKEN;
if (!host || !token) {
  console.error("FAIL: MYAX_HOST and MYAX_TOKEN are required");
  process.exit(1);
}

const outcome = await Effect.runPromise(
  runTerminalGhProbe({ host, token }).pipe(
    Effect.provide(terminalSocketLayer((url, options) => new WebSocket(url, options))),
    Effect.match({
      onFailure: (error) => ({
        ok: false,
        reason: error?._tag === "TerminalProbeError" ? error.reason : "the gh probe exceeded its budget",
        output: error?._tag === "TerminalProbeError" ? error.output : "",
      }),
      onSuccess: (summary) => ({ ok: true, summary }),
    }),
  ),
);

if (!outcome.ok) {
  console.error(`FAIL: ${outcome.reason}`);
  if (outcome.output) console.error(outcome.output);
  process.exit(1);
}
console.log(`ok: ${outcome.summary}`);
