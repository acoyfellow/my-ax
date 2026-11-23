#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { AttachView, ATTACH_COMMANDS, inputFrame, pickChat, reconnectDelay } from "./attach-core.mjs";

const USAGE = `my-ax attach <chat id, id prefix, or name>   join a chat from this terminal
my-ax chats                                  list pi chats

Environment:
  MYAX_URL     base URL, for example https://agent.example.com (required)
  MYAX_TOKEN   Access token; default: cloudflared access token -app=$MYAX_URL

In a chat: type a message and press Enter. ${ATTACH_COMMANDS.abort} stops the turn. ${ATTACH_COMMANDS.quit} or Ctrl-D leaves.`;

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

async function api(base, token, path) {
  const response = await fetch(`${base}${path}`, { headers: { "cf-access-token": token } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) fail(`${path} failed (HTTP ${response.status}). If this is a login page, run: cloudflared access login ${base}`);
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
    const frame = inputFrame(line, randomUUID());
    if (frame) send(frame);
  });
  input.on("close", () => setTimeout(leave, Number(process.env.MYAX_LINGER_MS ?? 0)));
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
