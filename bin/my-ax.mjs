#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { sessionSpans } from "./pi-spans.mjs";
import { basename } from "node:path";
import { AttachView, ATTACH_COMMANDS, decisionChoice, decisionPrompt, imageType, inputFrame, parseImageCommand, pickChat, reconnectDelay } from "./attach-core.mjs";

const USAGE = `my-ax attach <chat id, id prefix, or name>   join a chat from this terminal
my-ax chats                                  list pi chats
my-ax sync-pi [--days N]                     send local Pi session traces (no content) to brain_query

Environment:
  MYAX_URL     base URL, for example https://agent.example.com (required)
  MYAX_TOKEN   Access token; default: cloudflared access token -app=$MYAX_URL
  PI_SESSIONS  local Pi sessions folder; default: ~/.pi/agent/sessions

In a chat: type a message and press Enter. ${ATTACH_COMMANDS.image} <path> [message] sends an image. When the agent asks a question, answer with its number. ${ATTACH_COMMANDS.abort} stops the turn. ${ATTACH_COMMANDS.quit} or Ctrl-D leaves.`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function accessToken(base) {
  if (process.env.MYAX_TOKEN) return process.env.MYAX_TOKEN;
  try {
    return execFileSync("cloudflared", ["access", "token", `-app=${base}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    fail(`No Access token. Run: cloudflared access login ${base}`);
  }
}

async function api(base, token, path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "cf-access-token": token, ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    if (init.soft) return { error: body?.error?.message ?? `HTTP ${response.status}` };
    fail(`${path} failed (HTTP ${response.status}). If this is a login page, run: cloudflared access login ${base}`);
  }
  return body.result;
}

async function listChats(base, token) {
  const result = await api(base, token, "/api/sessions?limit=200");
  return result.sessions ?? [];
}

function attach(base, token, chat) {
  const view = new AttachView((text) => process.stdout.write(text));
  const wsUrl = `${base.replace(/^http/, "ws")}/agents/pi-chat/${chat.id}`;
  const pending = [];
  let socket = null;
  let attempt = 0;
  let leaving = false;

  const send = (frame) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
    else pending.push(frame);
  };

  const connect = () => {
    socket = new WebSocket(wsUrl, { headers: { "cf-access-token": token } });
    socket.addEventListener("open", () => {
      if (attempt > 0) process.stdout.write("  (reconnected)\n");
      void checkDecision();
      attempt = 0;
      while (pending.length) socket.send(JSON.stringify(pending.shift()));
    });
    socket.addEventListener("message", (message) => {
      try { view.frame(JSON.parse(String(message.data))); } catch {}
    });
    socket.addEventListener("close", () => {
      if (leaving) return;
      attempt += 1;
      const wait = reconnectDelay(attempt);
      process.stdout.write(`  (connection lost, retrying in ${Math.round(wait / 1000)}s)\n`);
      setTimeout(connect, wait);
    });
    socket.addEventListener("error", () => {});
  };

  let decision = null;
  let checking = false;
  const checkDecision = async () => {
    if (checking) return;
    checking = true;
    try {
      const result = await api(base, token, `/api/decisions/pending?sessionId=${encodeURIComponent(chat.id)}`, { soft: true });
      const next = result?.decision ? await api(base, token, `/api/decisions/${result.decision.id}/state`, { soft: true }) : null;
      if (next?.state === "open" && next.id !== decision?.id) {
        decision = next;
        view.endStream();
        process.stdout.write(decisionPrompt(decision));
      }
    } finally {
      checking = false;
    }
  };
  const answer = async (line) => {
    const choice = decisionChoice(decision, line);
    if (!choice) return process.stdout.write(`  pick 1-${decision.options.length}\n`);
    const asked = decision;
    decision = null;
    const result = await api(base, token, `/api/decisions/${asked.id}/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice }), soft: true });
    process.stdout.write(result?.error ? `! ${result.error}\n` : `  answered: ${choice}\n`);
  };
  const sendImage = async (path, message) => {
    const type = imageType(path);
    if (!type) return process.stdout.write("! /image needs a .png, .jpg, .webp or .gif file\n");
    const bytes = await readFile(path).catch(() => null);
    if (!bytes) return process.stdout.write(`! cannot read ${path}\n`);
    const form = new FormData();
    form.set("file", new File([bytes], basename(path), { type }));
    form.set("sessionId", chat.id);
    const attachment = await api(base, token, "/api/uploads", { method: "POST", body: form, soft: true });
    if (attachment?.error) return process.stdout.write(`! upload failed: ${attachment.error}\n`);
    process.stdout.write(`  (image ${basename(path)} attached)\n`);
    send({ type: "pi_submit", text: message, attachments: [attachment], operationId: randomUUID() });
  };
  view.onSettled = () => void checkDecision();

  process.stdout.write(`attached to "${chat.name ?? chat.id}" (${chat.id})\n`);
  connect();

  const input = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
  const leave = () => {
    leaving = true;
    socket?.close();
    process.exit(0);
  };
  input.on("line", (line) => {
    if (line.trim() === ATTACH_COMMANDS.quit) return leave();
    if (decision && line.trim() && !line.trim().startsWith("/")) return void answer(line);
    const image = parseImageCommand(line);
    if (image) return void sendImage(image.path, image.message);
    const frame = inputFrame(line, randomUUID());
    if (frame) send(frame);
  });
  input.on("close", () => setTimeout(leave, Number(process.env.MYAX_LINGER_MS ?? 0)));
}

const SYNC_BATCH = 500;
const SYNC_STATE = join(homedir(), ".my-ax", "sync-pi.json");

async function sessionFiles(root) {
  const files = [];
  for (const folder of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory()) continue;
    for (const name of await readdir(join(root, folder.name)).catch(() => [])) if (name.endsWith(".jsonl")) files.push(join(root, folder.name, name));
  }
  return files;
}

async function readFrom(path, offset) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size <= offset) return { text: "", size };
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    return { text: buffer.toString("utf8"), size };
  } finally {
    await handle.close();
  }
}

async function firstLine(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0];
  } finally {
    await handle.close();
  }
}

async function syncPi(base, token, days) {
  const root = process.env.PI_SESSIONS ?? join(homedir(), ".pi", "agent", "sessions");
  const state = JSON.parse(await readFile(SYNC_STATE, "utf8").catch(() => "{}"));
  const since = Date.now() - days * 86_400_000;
  let sent = 0;
  let rejected = 0;
  let files = 0;
  const post = async (spans) => {
    const result = await api(base, token, "/api/spans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "pi-local", spans }) });
    sent += result.stored;
    rejected += result.rejected;
  };
  for (const path of await sessionFiles(root)) {
    const info = await stat(path);
    if (info.mtimeMs < since) continue;
    const known = state[path] ?? { offset: 0 };
    if (info.size === known.offset) continue;
    const head = known.offset > 0 ? [await firstLine(path)] : [];
    const { text, size } = await readFrom(path, known.offset);
    const complete = text.lastIndexOf("\n") + 1;
    const spans = sessionSpans([...head, ...text.slice(0, complete).split("\n")], since);
    for (let index = 0; index < spans.length; index += SYNC_BATCH) await post(spans.slice(index, index + SYNC_BATCH));
    state[path] = { offset: known.offset + Buffer.byteLength(text.slice(0, complete)) };
    if (size !== info.size) state[path].offset = Math.min(state[path].offset, size);
    files += spans.length ? 1 : 0;
    await mkdir(dirname(SYNC_STATE), { recursive: true });
    await writeFile(SYNC_STATE, JSON.stringify(state));
  }
  process.stdout.write(`synced ${sent} spans from ${files} sessions${rejected ? `, ${rejected} rejected` : ""}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "-h" || command === "--help") return process.stdout.write(`${USAGE}\n`);
  const base = (process.env.MYAX_URL ?? "").replace(/\/+$/, "");
  if (!base) fail("Set MYAX_URL, for example MYAX_URL=https://agent.example.com");
  const token = accessToken(base);
  if (command === "chats") {
    for (const chat of (await listChats(base, token)).filter((session) => session.engine === "pi")) process.stdout.write(`${chat.id.slice(0, 8)}  ${chat.status.padEnd(8)}  ${chat.name ?? ""}\n`);
    return;
  }
  if (command === "sync-pi") {
    const flag = rest.indexOf("--days");
    const days = flag >= 0 ? Number(rest[flag + 1]) : 7;
    if (!Number.isFinite(days) || days <= 0 || days > 90) fail("--days must be between 1 and 90");
    return syncPi(base, token, days);
  }
  if (command === "attach") {
    const query = rest.join(" ").trim();
    if (!query) fail("Usage: my-ax attach <chat id, id prefix, or name>");
    const chat = pickChat(await listChats(base, token), query);
    if (!chat) fail(`No single pi chat matches "${query}". Run: my-ax chats`);
    return attach(base, token, chat);
  }
  fail(USAGE);
}

await main();
