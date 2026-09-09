import { Data, Effect } from "effect";
import { TerminalSocketFactory } from "./terminal-socket.mjs";

export class TerminalProbeError extends Data.TaggedError("TerminalProbeError") {}

function cleanTranscript(value) {
  return value.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "");
}

function awaitOpen(socket) {
  return Effect.callback((resume) => {
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("unexpected-response", onUnexpectedResponse);
    };
    const onOpen = () => {
      cleanup();
      resume(Effect.void);
    };
    const onError = () => {
      cleanup();
      resume(Effect.fail(new TerminalProbeError({ reason: "terminal connection failed", output: "" })));
    };
    const onUnexpectedResponse = (_request, response) => {
      cleanup();
      resume(Effect.fail(new TerminalProbeError({ reason: `terminal answered ${response.statusCode}`, output: "" })));
    };
    socket.on("open", onOpen);
    socket.on("error", onError);
    socket.on("unexpected-response", onUnexpectedResponse);
    return Effect.sync(cleanup);
  });
}

function useSocket(socket, config) {
  return Effect.gen(function* () {
    yield* awaitOpen(socket);
    let transcript = "";
    const onMessage = (data, isBinary) => {
      if (isBinary) transcript += data.toString("utf8");
    };
    socket.on("message", onMessage);
    yield* Effect.addFinalizer(() => Effect.sync(() => socket.off("message", onMessage)));
    yield* Effect.sleep(config.initialDelayMs ?? 1500);
    transcript = "";
    yield* Effect.try({
      try: () => socket.send(Buffer.from("command -v gh && gh --version\n", "utf8"), { binary: true }),
      catch: () => new TerminalProbeError({ reason: "terminal command failed", output: "" }),
    });
    const attempts = config.attempts ?? 20;
    for (let attempt = 0; attempt < attempts && !/gh version|not found/.test(cleanTranscript(transcript)); attempt += 1) {
      yield* Effect.sleep(config.pollDelayMs ?? 1500);
    }
    const output = cleanTranscript(transcript);
    if (!/gh version/.test(output)) {
      return yield* Effect.fail(new TerminalProbeError({
        reason: "gh is not on PATH in the container",
        output: output.split("\n").filter((line) => line.trim()).slice(-4).join("\n"),
      }));
    }
    if (/\/home\/user\/\.local\/bin\/gh/.test(output)) {
      return yield* Effect.fail(new TerminalProbeError({
        reason: "gh resolved to a workspace-local copy, which a recycle destroys",
        output: "",
      }));
    }
    return output.split(/\r?\n/u).find((line) => line.startsWith("gh version ")) ?? "gh present";
  });
}

export function runTerminalGhProbe(config) {
  return Effect.gen(function* () {
    const factory = yield* TerminalSocketFactory;
    const url = `${config.host.replace(/^https:/, "wss:")}/api/workspace/terminal?cols=100&rows=30`;
    return yield* Effect.acquireRelease(
      Effect.try({
        try: () => factory.connect(url, { headers: { "cf-access-token": config.token } }),
        catch: () => new TerminalProbeError({ reason: "terminal connection failed", output: "" }),
      }),
      (socket) => Effect.sync(() => socket.close()),
    ).pipe(
      Effect.flatMap((socket) => useSocket(socket, config)),
      Effect.scoped,
      Effect.timeout(config.timeoutMs ?? 180_000),
    );
  });
}
