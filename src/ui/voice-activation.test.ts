import assert from "node:assert/strict";
import test from "node:test";
import { VoiceActivationLifecycle, createAndPrepareVoiceSession, type VoiceActivationClient } from "./voice-activation";

class FakeVoiceClient implements VoiceActivationClient {
  connected = false;
  connectCalls = 0;
  startCalls = 0;
  endCalls = 0;
  disconnectCalls = 0;
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
    return Promise.resolve();
  }

  endCall(): void {
    this.endCalls += 1;
    this.events.push("end");
  }

  disconnect(): void {
    this.disconnectCalls += 1;
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

test("a disconnected same-session tap reconnects and starts on the same client", async () => {
  const clients: FakeVoiceClient[] = [];
  const lifecycle = new VoiceActivationLifecycle<FakeVoiceClient>();
  const createClient = factory(clients);
  const disconnected = lifecycle.prepare("session-a", createClient);

  const attempt = lifecycle.activate("session-a", createClient);
  assert.equal(attempt.kind, "started");
  assert.equal(clients.length, 1);
  assert.equal(disconnected.connectCalls, 2);
  assert.equal(disconnected.startCalls, 1);
  if (attempt.kind === "started") await attempt.completion;
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
  };

  lifecycle.clear();

  assert.equal(client.endCalls, 1);
  assert.equal(client.disconnectCalls, 1);
  assert.deepEqual(callbackAcceptance, [false, false]);
});
