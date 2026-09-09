import { Data, Effect } from "effect";
import { TerminalSocketFactory } from "./terminal-socket.mjs";

export class TerminalUpgradeError extends Data.TaggedError("TerminalUpgradeError") {}

function observeUpgrade(socket) {
  return Effect.callback((resume) => {
    let upgraded = false;
    const cleanup = () => {
      socket.off("upgrade", onUpgrade);
      socket.off("unexpected-response", onUnexpectedResponse);
      socket.off("error", onError);
      socket.off("message", onMessage);
    };
    const succeed = () => {
      cleanup();
      resume(Effect.succeed("the terminal endpoint upgraded (101) and a live pty sent binary output"));
    };
    const fail = (reason) => {
      cleanup();
      resume(Effect.fail(new TerminalUpgradeError({ reason })));
    };
    const onUpgrade = (response) => {
      upgraded = response.statusCode === 101;
    };
    const onUnexpectedResponse = (_request, response) => fail(`the terminal endpoint answered ${response.statusCode}`);
    const onError = () => fail("the terminal connection failed");
    const onMessage = (_data, isBinary) => {
      if (!isBinary) return;
      if (!upgraded) fail("pty bytes arrived without a 101 upgrade");
      else succeed();
    };
    socket.on("upgrade", onUpgrade);
    socket.on("unexpected-response", onUnexpectedResponse);
    socket.on("error", onError);
    socket.on("message", onMessage);
    return Effect.sync(cleanup);
  });
}

export function runTerminalUpgradeProbe(config) {
  return Effect.gen(function* () {
    const factory = yield* TerminalSocketFactory;
    const url = `${config.host.replace(/^https:/, "wss:")}/api/workspace/terminal?cols=80&rows=24`;
    return yield* Effect.acquireRelease(
      Effect.try({
        try: () => factory.connect(url, { headers: { "cf-access-token": config.token } }),
        catch: () => new TerminalUpgradeError({ reason: "the terminal connection failed" }),
      }),
      (socket) => Effect.sync(() => socket.close()),
    ).pipe(
      Effect.flatMap(observeUpgrade),
      Effect.scoped,
      Effect.timeout(config.timeoutMs ?? 60_000),
    );
  });
}
