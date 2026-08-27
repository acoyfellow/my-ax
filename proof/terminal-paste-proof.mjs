import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import wsPkg from "ws";

const WebSocket = wsPkg;
const cdp = process.env.CDP_URL || "http://127.0.0.1:19222";
const bundle = process.env.CLOUDTERM_BUNDLE;
if (!bundle) {
  console.error("FAIL: CLOUDTERM_BUNDLE is required");
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
setTimeout(() => { console.error("FAIL: the paste proof exceeded its budget"); process.exit(1); }, 120_000).unref?.();

const sentinel = `PASTE_${Date.now()}`;
const withBrackets = `\u001b[?2004h${sentinel}\u001b[?2004l\r\n`;
const payload = Buffer.from(withBrackets, "utf8").toString("base64");

const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b1118">
<div id="term" style="height:20rem;padding:.5rem"></div>
<script>
const nativeRaf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;
window.requestAnimationFrame = (cb) => {
  let done = false;
  const run = (t) => { if (done) return; done = true; try { cb(t ?? performance.now()); } catch (e) { window.__err = String(e); } };
  if (nativeRaf) nativeRaf(run);
  setTimeout(() => run(performance.now()), 32);
  return 0;
};
</script>
<script type="module">
import { mount } from "/cloudterm.js";
const term = await mount(document.getElementById("term"), { onData: () => {} });
term.write(Uint8Array.from(atob("${payload}"), (c) => c.charCodeAt(0)));
window.__painted = () => document.getElementById("term").innerText;
</script></body>`;

const server = createServer((req, res) => {
  if (req.url.startsWith("/cloudterm.js")) {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(readFileSync(bundle));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(page);
});
const port = await new Promise((resolve, reject) => {
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((resolve) => socket.on("open", resolve));
let id = 0;
const pending = new Map();
socket.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); socket.send(JSON.stringify({ id: mid, method, params })); });

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });

let painted = "";
for (let attempt = 0; attempt < 20; attempt += 1) {
  await wait(1000);
  const probe = await send("Runtime.evaluate", { expression: "window.__painted ? window.__painted() : null", returnByValue: true });
  const value = probe.result?.result?.value;
  if (typeof value === "string" && value.trim().length > 0) { painted = value; break; }
}

server.close();
await fetch(`${cdp}/json/close/${target.id}`).catch(() => {});

if (!painted.includes(sentinel)) {
  console.error("FAIL: the pasted text never rendered");
  console.error(`painted: ${JSON.stringify(painted.slice(0, 200))}`);
  process.exit(1);
}
for (const leak of ["2004h", "2004l", "[?2004"]) {
  if (painted.includes(leak)) {
    console.error(`FAIL: the escape sequence ${leak} leaked into the rendered text`);
    console.error(`painted: ${JSON.stringify(painted.slice(0, 200))}`);
    process.exit(1);
  }
}
console.log("ok: bracketed paste is consumed as a mode change, not painted as text");
process.exit(0);
