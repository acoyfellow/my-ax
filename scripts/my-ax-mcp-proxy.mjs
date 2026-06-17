#!/usr/bin/env node
// Local stdio → deployed my-ax MCP proxy. Requires MY_AX_ORIGIN.
// Retrieves a cached Access JWT through cloudflared for each request. The token
// stays process-local, is never persisted by this adapter, and is never logged.

import { execFileSync } from "node:child_process";

const APP = process.env.MY_AX_ORIGIN;
if (!APP) {
  console.error("MY_AX_ORIGIN env var required (e.g. https://ax.example.com)");
  process.exit(2);
}
const MCP = `${APP.replace(/\/$/, "")}/api/mcp`;
let sessionId = null;
let buffer = "";

function accessToken() {
  try {
    const token = execFileSync("cloudflared", ["access", "token", `--app=${APP}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).trim();
    if (!token) throw new Error("empty token");
    return token;
  } catch {
    throw new Error(`my-ax Access login required. Run: cf-local recover my-ax --run`);
  }
}
function write(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
async function forward(message) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "cf-access-token": accessToken() };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(MCP, { method: "POST", headers, body: JSON.stringify(message) });
  const nextSession = response.headers.get("mcp-session-id");
  if (nextSession) sessionId = nextSession;
  const body = await response.text();
  if (!response.ok) throw new Error(`my-ax MCP HTTP ${response.status}: ${body.slice(0, 300)}`);
  if (!body.trim()) return null;
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = body.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
    return data ? JSON.parse(data) : null;
  }
  return JSON.parse(body);
}
async function handle(line) {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); }
  catch (error) { return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } }); }
  const notification = message.id === undefined || message.id === null;
  try {
    const response = await forward(message);
    if (!notification && response) write(response);
  } catch (error) {
    if (!notification) write({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32000, message: error.message } });
  }
}
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    await handle(line);
  }
}
if (buffer.trim()) await handle(buffer);
