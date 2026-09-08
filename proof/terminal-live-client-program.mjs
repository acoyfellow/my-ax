import { Data, Effect } from "effect";
import { TerminalSocketFactory } from "./terminal-socket.mjs";

export class TerminalLiveError extends Data.TaggedError("TerminalLiveError") {}

function awaitOpen(socket, timeoutMs) {
  return Effect.callback((resume) => {
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("unexpected-response", onUnexpectedResponse);
      socket.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resume(Effect.void);
    };
    const onUnexpectedResponse = (_request, response) => {
      cleanup();
      resume(Effect.fail(new TerminalLiveError({ reason: `pty upgrade answered ${response.statusCode}` })));
    };
    const onError = () => {
      cleanup();
      resume(Effect.fail(new TerminalLiveError({ reason: "pty connection failed" })));
    };
    socket.on("open", onOpen);
    socket.on("unexpected-response", onUnexpectedResponse);
    socket.on("error", onError);
    return Effect.sync(cleanup);
  }).pipe(Effect.timeout(timeoutMs));
}

function send(socket, value, binary) {
  return Effect.try({
    try: () => socket.send(value, binary === undefined ? undefined : { binary }),
    catch: () => new TerminalLiveError({ reason: "pty send failed" }),
  });
}

function withConnection(factory, url, token, timeoutMs, use) {
  return Effect.acquireRelease(
    Effect.try({
      try: () => factory.connect(url, { headers: { "cf-access-token": token } }),
      catch: () => new TerminalLiveError({ reason: "pty connection failed" }),
    }),
    (socket) => Effect.sync(() => socket.close()),
  ).pipe(
    Effect.flatMap((socket) => Effect.gen(function* () {
      const transcript = { text: "", binaryFrames: 0 };
      const onMessage = (data, isBinary) => {
        if (isBinary) transcript.binaryFrames += 1;
        transcript.text += data.toString("utf8");
      };
      socket.on("message", onMessage);
      yield* Effect.addFinalizer(() => Effect.sync(() => socket.off("message", onMessage)));
      yield* awaitOpen(socket, timeoutMs);
      return yield* use(socket, transcript);
    })),
    Effect.scoped,
  );
}

export function runTerminalLiveProof(config) {
  const initialDelayMs = config.initialDelayMs ?? 1500;
  const commandDelayMs = config.commandDelayMs ?? 2500;
  const exportDelayMs = config.exportDelayMs ?? 1200;
  const resizeDelayMs = config.resizeDelayMs ?? 800;
  const resizeProbeDelayMs = config.resizeProbeDelayMs ?? 2000;
  const reconnectDelayMs = config.reconnectDelayMs ?? 3000;
  const reconnectReadyDelayMs = config.reconnectReadyDelayMs ?? 1800;
  const connectTimeoutMs = config.connectTimeoutMs ?? 45_000;
  const url = `${config.host.replace(/^https:/, "wss:")}/api/workspace/terminal?cols=80&rows=24`;

  return Effect.gen(function* () {
    const factory = yield* TerminalSocketFactory;
    const checks = [];
    const check = (label, condition) => checks.push({ label, ok: condition });

    yield* withConnection(factory, url, config.token, connectTimeoutMs, (socket, transcript) => Effect.gen(function* () {
      yield* Effect.sleep(initialDelayMs);
      check("the pty announces itself ready", transcript.text.includes('"type":"ready"'));
      check("the shell paints a prompt", /\$ |# /.test(transcript.text));

      yield* send(socket, Buffer.from(`echo ${config.canary}_$((6*7))\n`, "utf8"), true);
      yield* Effect.sleep(commandDelayMs);
      check("a typed command executes in a real shell", transcript.text.includes(`${config.canary}_42`));
      check("pty output arrives as binary frames", transcript.binaryFrames > 0);

      yield* send(socket, Buffer.from(`export PTY_GATE_MARKER=${config.canary}_marker\n`, "utf8"), true);
      yield* Effect.sleep(exportDelayMs);
      yield* send(socket, JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
      yield* Effect.sleep(resizeDelayMs);
      yield* send(socket, Buffer.from("stty size\n", "utf8"), true);
      yield* Effect.sleep(resizeProbeDelayMs);
      check("a resize control frame changes the tty size", /40 120/.test(transcript.text));
      check("a valid control frame is not rejected", !transcript.text.includes("Invalid control message"));
    }));

    yield* Effect.sleep(reconnectDelayMs);

    yield* withConnection(factory, url, config.token, connectTimeoutMs, (socket, transcript) => Effect.gen(function* () {
      yield* Effect.sleep(reconnectReadyDelayMs);
      check("a reconnect replays buffered scrollback", transcript.text.length > 0);
      yield* send(socket, Buffer.from("echo survived:$PTY_GATE_MARKER\n", "utf8"), true);
      yield* Effect.sleep(commandDelayMs);
      check("the same shell process survives a reconnect", transcript.text.includes(`survived:${config.canary}_marker`));
    }));

    return { checks, failures: checks.filter((check) => !check.ok).map((check) => check.label) };
  }).pipe(Effect.timeout(config.timeoutMs ?? 180_000));
}
