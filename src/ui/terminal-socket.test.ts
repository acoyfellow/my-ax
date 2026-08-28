import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TERMINAL_ENDPOINT, TerminalSocket, terminalUrl } from "./terminal-socket";

class FakeSocket {
  static last: FakeSocket | null = null;
  binaryType = "";
  readyState = 1;
  sent: Array<Uint8Array | string> = [];
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(payload: Uint8Array | string) {
    this.sent.push(payload);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  deliver(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function harness() {
  const bytes: Uint8Array[] = [];
  const statuses: Array<{ status: string; detail?: string }> = [];
  const socket = new TerminalSocket({
    onBytes: (b) => bytes.push(b),
    onStatus: (status, detail) => statuses.push({ status, detail }),
    openSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
  });
  socket.connect("wss://example.invalid/api/workspace/terminal?cols=80&rows=24");
  return { socket, bytes, statuses, fake: () => FakeSocket.last! };
}

test("the terminal url upgrades the scheme and carries the size", () => {
  assert.equal(terminalUrl("https://example.invalid", 100, 30), `wss://example.invalid${TERMINAL_ENDPOINT}?cols=100&rows=30`);
  assert.equal(terminalUrl("http://127.0.0.1:8787", 80, 24), `ws://127.0.0.1:8787${TERMINAL_ENDPOINT}?cols=80&rows=24`);
});

test("the socket asks for arraybuffers, because pty output arrives as binary frames", () => {
  const { fake } = harness();
  assert.equal(fake().binaryType, "arraybuffer");
});

test("keystrokes go out as binary, never as a text frame the container would parse as control json", () => {
  const { socket, fake } = harness();
  assert.equal(socket.send(new TextEncoder().encode("echo hi\n")), true);
  const [payload] = fake().sent;
  assert.ok(payload instanceof Uint8Array, "keystrokes must be sent as bytes");
  assert.equal(new TextDecoder().decode(payload as Uint8Array), "echo hi\n");
});

test("a resize goes out as a text control frame", () => {
  const { socket, fake } = harness();
  assert.equal(socket.resize(120, 40), true);
  const payload = fake().sent[0];
  assert.equal(typeof payload, "string");
  assert.deepEqual(JSON.parse(payload as string), { type: "resize", cols: 120, rows: 40 });
});

test("a resize refuses dimensions the container would reject", () => {
  const { socket, fake } = harness();
  assert.equal(socket.resize(0, 40), false);
  assert.equal(socket.resize(120, -2), false);
  assert.equal(fake().sent.length, 0);
});

test("a ready status frame is status, not terminal output", () => {
  const { bytes, statuses, fake } = harness();
  fake().deliver(JSON.stringify({ type: "ready" }));
  assert.equal(bytes.length, 0, "a status frame must never be painted as terminal bytes");
  assert.ok(statuses.some((s) => s.status === "ready"));
});

test("an error status frame surfaces its message", () => {
  const { statuses, fake } = harness();
  fake().deliver(JSON.stringify({ type: "error", message: "Invalid control message" }));
  const error = statuses.find((s) => s.status === "error");
  assert.equal(error?.detail, "Invalid control message");
});

test("binary frames are painted as terminal output", () => {
  const { bytes, fake } = harness();
  const payload = new TextEncoder().encode("user@my-ax $ ");
  fake().deliver(payload.buffer);
  assert.equal(bytes.length, 1);
  assert.equal(new TextDecoder().decode(bytes[0]), "user@my-ax $ ");
});

test("sending before the socket is open reports failure instead of dropping input silently", () => {
  const { socket, fake } = harness();
  fake().readyState = 0;
  assert.equal(socket.send(new TextEncoder().encode("x")), false);
});

test("the panel sends what cloudterm gives it and paints what the socket returns", () => {
  const source = readFileSync(new URL("./Terminal.svelte", import.meta.url), "utf8");
  assert.match(source, /onData:\s*\(bytes: Uint8Array\)/, "cloudterm keystrokes must be forwarded");
  assert.match(source, /socket\?\.send\(bytes\)/, "keystrokes must reach the socket");
  assert.match(source, /term\?\.write\(bytes\)/, "pty bytes must be painted by cloudterm");
  assert.match(source, /socket\.?\.resize\(cols, rows\)/, "a cloudterm resize must reach the pty");
  assert.doesNotMatch(source, /\/api\/errors/, "terminal bytes must never be posted to the error queue");
});

test("chat hosts the inline terminal and the shell has no top-bar control", () => {
  const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
  const shell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
  assert.match(chat, /<Terminal \/>/, "the terminal must be mounted in chat");
  assert.doesNotMatch(shell, /id="terminal-button"/, "the top-bar terminal button must be gone");
  assert.doesNotMatch(shell, /<Terminal \/>/, "the shell must not host a global terminal overlay");
});
