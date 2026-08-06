import assert from "node:assert/strict";
import test from "node:test";
import { RetirableVoiceStream, VoiceActivationLifecycle, createAndPrepareVoiceSession, type VoiceActivationClient } from "./voice-activation";

class FakeVoiceClient implements VoiceActivationClient {
  connected = false;
  connectCalls = 0;
  startCalls = 0;
  endCalls = 0;
  disconnectCalls = 0;
  phase = "idle";
  queuedAudio: string[] = [];
  microphoneCapturing = false;
  startCompletion: Promise<void> = Promise.resolve();
  prepareAudio?: () => void;
  readonly events: string[];

  constructor(events: string[] = []) {
    this.events = events;
  }

  connect(): void {
    this.connectCalls += 1;
    this.events.push("connect");
  }

  startCall(): Promise<void> {
    this.startCalls += 1;
    this.events.push("start");
    return this.startCompletion.then(() => {
      this.phase = "listening";
      this.microphoneCapturing = true;
    });
  }

  endCall(): void {
    this.endCalls += 1;
    this.phase = "idle";
    this.queuedAudio = [];
    this.microphoneCapturing = false;
    this.events.push("end");
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.endCall();
    this.connected = false;
    this.events.push("disconnect");
  }
}

function factory(clients: FakeVoiceClient[], events: string[] = []) {
  return () => {
    const client = new FakeVoiceClient(events);
    clients.push(client);
    return client;
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("a new voice session attaches chat persistence before preparing audio", async () => {
  const events: string[] = [];
  const result = await createAndPrepareVoiceSession(
    async () => "session-a",
    (sessionId) => sessionId === "session-a",
    (sessionId) => events.push(`chat:${sessionId}`),
    (sessionId) => events.push(`voice:${sessionId}`),
  );

  assert.equal(result, "session-a");
  assert.deepEqual(events, ["chat:session-a", "voice:session-a"]);
});

test("a stale new session attaches neither chat nor voice", async () => {
  const events: string[] = [];
  const result = await createAndPrepareVoiceSession(
    async () => "session-a",
    () => false,
    () => events.push("chat"),
    () => events.push("voice"),
  );

  assert.equal(result, null);
  assert.deepEqual(events, []);
});

test("a second tap starts a created, prepared, ready client without disconnecting it", async () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const createClient = factory(clients);
  let currentSessionId: string | null = null;
  const sessionId = await createAndPrepareVoiceSession(
    async () => "session-a",
    (id) => id === "session-a" && currentSessionId === null,
    (id) => { currentSessionId = id; },
    (id) => { lifecycle.prepare(id, createClient); },
  );
  const client = clients[0];

  assert.equal(sessionId, "session-a");
  assert.equal(client.startCalls, 0);
  assert.equal(client.disconnectCalls, 0);

  client.connected = true;
  const attempt = lifecycle.activate(currentSessionId, createClient);

  assert.equal(attempt.kind, "started");
  if (attempt.kind === "started") await attempt.completion;
  assert.equal(client.startCalls, 1);
  assert.equal(client.disconnectCalls, 0);
});

test("a matching connected client starts synchronously inside activation", async () => {
  const events: string[] = [];
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const createClient = factory(clients, events);
  const client = lifecycle.prepare("session-a", createClient);
  client.connected = true;
  events.length = 0;

  const attempt = lifecycle.activate("session-a", createClient);
  events.push("returned");

  assert.equal(attempt.kind, "started");
  assert.deepEqual(events, ["start", "returned"]);
  if (attempt.kind === "started") await attempt.completion;
});

test("connection events never start a prepared client", () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const client = lifecycle.prepare("session-a", factory(clients));

  client.connected = true;
  assert.equal(lifecycle.acceptsEvent("session-a", client, "session-a"), true);
  assert.equal(client.startCalls, 0);
});

test("a no-session tap cannot start later after session preparation and connection", () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const createClient = factory(clients);

  assert.equal(lifecycle.activate(null, createClient).kind, "needs-session");
  const client = lifecycle.prepare("session-a", createClient);
  client.connected = true;
  lifecycle.acceptsEvent("session-a", client, "session-a");

  assert.equal(client.startCalls, 0);
});

test("a disconnected-client tap replaces and prepares without starting on connection", () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const createClient = factory(clients);
  const disconnected = lifecycle.prepare("session-a", createClient);

  const attempt = lifecycle.activate("session-a", createClient);
  assert.equal(attempt.kind, "preparing");
  assert.equal(attempt.kind === "preparing" && attempt.reason, "disconnected-client");
  assert.equal(disconnected.endCalls, 1);
  assert.equal(disconnected.disconnectCalls, 1);
  const replacement = clients[1];
  replacement.connected = true;
  lifecycle.acceptsEvent("session-a", replacement, "session-a");

  assert.equal(disconnected.startCalls, 0);
  assert.equal(replacement.startCalls, 0);

  const secondTap = lifecycle.activate("session-a", createClient);
  assert.equal(secondTap.kind, "started");
  assert.equal(replacement.startCalls, 1);
  assert.equal(replacement.disconnectCalls, 0);
});

test("a wrong-session tap retires the old client and never starts the replacement later", () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const createClient = factory(clients);
  const oldClient = lifecycle.prepare("session-a", createClient);
  oldClient.connected = true;

  const attempt = lifecycle.activate("session-b", createClient);
  assert.equal(attempt.kind, "preparing");
  assert.equal(attempt.kind === "preparing" && attempt.reason, "wrong-session");
  const replacement = clients[1];
  replacement.connected = true;
  lifecycle.acceptsEvent("session-b", replacement, "session-b");

  assert.equal(oldClient.startCalls, 0);
  assert.equal(replacement.startCalls, 0);
});

test("events from retired clients and changed sessions are suppressed", () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const createClient = factory(clients);
  const oldClient = lifecycle.prepare("session-a", createClient);
  const currentClient = lifecycle.prepare("session-b", createClient);

  assert.equal(lifecycle.acceptsEvent("session-a", oldClient, "session-b"), false);
  assert.equal(lifecycle.acceptsEvent("session-b", currentClient, "session-c"), false);
  assert.equal(lifecycle.acceptsEvent("session-b", currentClient, "session-b"), true);
});

test("clear invalidates callbacks before ending and disconnecting the client", () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const client = lifecycle.prepare("session-a", factory(clients));
  const callbackAcceptance: boolean[] = [];
  client.endCall = () => {
    client.endCalls += 1;
    callbackAcceptance.push(lifecycle.acceptsEvent("session-a", client, "session-a"));
  };
  client.disconnect = () => {
    client.disconnectCalls += 1;
    callbackAcceptance.push(lifecycle.acceptsEvent("session-a", client, "session-a"));
    client.endCall();
  };

  lifecycle.clear();

  assert.equal(client.endCalls, 1);
  assert.equal(client.disconnectCalls, 1);
  assert.deepEqual(callbackAcceptance, [false, false]);
});

test("stop is idempotent and clears local audio, microphone capture, and transport in every voice phase", () => {
  for (const phase of ["connecting", "listening", "thinking", "speaking", "error"]) {
    const clients: FakeVoiceClient[] = [];
    const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
    const client = lifecycle.prepare("session-a", factory(clients));
    client.phase = phase;
    client.queuedAudio = ["current", "queued"];
    client.microphoneCapturing = true;

    lifecycle.clear();
    lifecycle.clear();

    assert.equal(client.phase, "idle", phase);
    assert.deepEqual(client.queuedAudio, [], phase);
    assert.equal(client.microphoneCapturing, false, phase);
    assert.equal(client.endCalls, 1, phase);
    assert.equal(client.disconnectCalls, 1, phase);
  }
});

test("a stop during an unresolved start retires its late microphone restart", async () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const client = lifecycle.prepare("session-a", factory(clients));
  const start = deferred<void>();
  client.connected = true;
  client.startCompletion = start.promise;

  const attempt = lifecycle.activate("session-a", factory(clients));
  assert.equal(attempt.kind, "started");
  lifecycle.clear();
  assert.equal(client.microphoneCapturing, false);
  start.resolve();
  if (attempt.kind === "started") await attempt.completion;

  assert.equal(client.microphoneCapturing, false);
  assert.equal(client.phase, "idle");
  assert.equal(client.endCalls, 2);
  assert.equal(client.disconnectCalls, 2);
});

test("a stopped pending getUserMedia request retires its late track before VoiceClient can capture", async () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const permission = deferred<{ getTracks(): Array<{ stop(): void }> }>();
  const microphone = new RetirableVoiceStream(() => permission.promise);
  const client = lifecycle.prepare("session-a", factory(clients));
  const stoppedTracks: number[] = [];
  client.connected = true;
  client.prepareAudio = () => { void microphone.prepare().catch(() => {}); };
  client.startCall = async () => {
    client.startCalls += 1;
    client.events.push("start_call");
    const stream = await microphone.prepare();
    if (!stream) return;
    client.phase = "listening";
    client.microphoneCapturing = true;
  };
  client.endCall = () => {
    client.endCalls += 1;
    microphone.retire();
    client.phase = "idle";
    client.microphoneCapturing = false;
    client.events.push("end");
  };

  const attempt = lifecycle.activate("session-a", factory(clients));
  assert.equal(attempt.kind, "started");
  lifecycle.clear();
  permission.resolve({ getTracks: () => [{ stop: () => stoppedTracks.push(1) }] });
  if (attempt.kind === "started") await attempt.completion;

  assert.deepEqual(client.events.slice(1, 4), ["start_call", "end", "disconnect"]);
  assert.equal(stoppedTracks.length, 1);
  assert.equal(client.microphoneCapturing, false);
  assert.equal(client.phase, "idle");
});

test("a session switch and unmount reject callbacks from every retired generation", () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const first = lifecycle.prepare("session-a", factory(clients));
  const second = lifecycle.prepare("session-b", factory(clients));

  for (const phase of ["connecting", "listening", "thinking", "speaking", "error"]) {
    assert.equal(lifecycle.acceptsEvent("session-a", first, "session-a"), false, phase);
    assert.equal(lifecycle.acceptsEvent("session-b", second, "session-a"), false, phase);
    assert.equal(lifecycle.acceptsEvent("session-b", second, "session-b"), true, phase);
  }

  lifecycle.clear();

  assert.equal(lifecycle.acceptsEvent("session-b", second, "session-b"), false);
  assert.equal(first.endCalls, 1);
  assert.equal(first.disconnectCalls, 1);
  assert.equal(second.endCalls, 1);
  assert.equal(second.disconnectCalls, 1);
});
