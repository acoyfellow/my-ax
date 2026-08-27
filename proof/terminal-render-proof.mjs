import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import wsPkg from "ws";

const WebSocket = wsPkg;
const { WebSocketServer } = wsPkg;
const host = process.env.MYAX_HOST;
const token = process.env.MYAX_TOKEN;
const cdp = process.env.CDP_URL || "http://127.0.0.1:19222";
const bundle = process.env.CLOUDTERM_BUNDLE;
if (!host || !token || !bundle) {
  console.error("FAIL: MYAX_HOST, MYAX_TOKEN and CLOUDTERM_BUNDLE are required");
  process.exit(1);
}

const sentinel = `RENDER_${Date.now()}`;
setTimeout(() => { console.error("FAIL: the render proof exceeded its budget"); process.exit(1); }, 120_000).unref?.();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const captured = [];
const live = new WebSocket(`${host.replace(/^https:/, "wss:")}/api/workspace/terminal?cols=80&rows=24`, {
  headers: { "cf-access-token": token },
});
await new Promise((resolve, reject) => {
  live.on("open", resolve);
  live.on("error", reject);
  setTimeout(() => reject(new Error("the deployed pty did not upgrade")), 45_000);
});
live.on("message", (data, isBinary) => { if (isBinary) captured.push(Buffer.from(data)); });
await wait(1500);
live.send(Buffer.from(`echo ${sentinel}_$((6*7))\n`, "utf8"), { binary: true });
await wait(2500);
live.close();

const realBytes = Buffer.concat(captured);
if (realBytes.length === 0) { console.error("FAIL: the deployed pty produced no binary output"); process.exit(1); }
if (!realBytes.toString("utf8").includes(`${sentinel}_42`)) { console.error("FAIL: the deployed pty never executed the typed command"); process.exit(1); }
console.log(`ok: captured ${realBytes.length} bytes of real pty output from the deployed worker`);

const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b1118">
<div id="term" style="height:26rem;padding:.5rem"></div>
<script>
const nativeRaf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;
window.requestAnimationFrame = (cb) => {
  let done = false;
  const run = (t) => { if (done) return; done = true; try { cb(t ?? performance.now()); } catch (e) { window.__err = String(e); } };
  if (nativeRaf) nativeRaf(run);
  setTimeout(() => run(performance.now()), 32);
  return 0;
};
window.onerror=(m)=>{window.__err=String(m)};window.addEventListener("unhandledrejection",e=>{window.__err="reject: "+e.reason});window.__stage="html";</script>
<script type="module">
import { mount } from "/cloudterm.js";
window.__stage = "importing";
const term = await mount(document.getElementById("term"), { onData: () => {} });
window.__stage = "mounted";
const bytes = Uint8Array.from(atob("${realBytes.toString("base64")}"), (c) => c.charCodeAt(0));
term.write(bytes);
window.__painted = () => document.getElementById("term").innerText;
window.onerror = (m) => { window.__err = String(m); };
</script></body>`;

const server = createServer((req, res) => {
  if (req.url.startsWith("/cloudterm.js")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(readFileSync(bundle)); return; }
  res.writeHead(200, { "content-type": "text/html" }); res.end(page);
});
const port = await new Promise((resolve, reject) => {
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((r) => socket.on("open", r));
let id = 0; const pending = new Map();
socket.on("message", (m) => { const msg = JSON.parse(m.toString()); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); socket.send(JSON.stringify({ id: mid, method, params })); });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
await send("Page.bringToFront");
await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
let painted = "";
let lastProbe = null;
for (let attempt = 0; attempt < 20; attempt += 1) {
  await wait(1000);
  const probe = await send("Runtime.evaluate", { expression: "JSON.stringify({p: window.__painted ? window.__painted() : null, err: window.__err || null, stage: window.__stage || null})", returnByValue: true });
  lastProbe = probe.result?.result?.value ?? null;
  let parsed = null;
  try { parsed = JSON.parse(probe.result?.result?.value ?? "null"); } catch {}
  if (parsed?.p && String(parsed.p).trim().length > 0) { painted = String(parsed.p); break; }
}


const shot = await Promise.race([
  send("Page.captureScreenshot", { format: "png" }),
  wait(8000).then(() => null),
]);
if (shot?.result?.data) writeFileSync("/tmp/terminal-render-proof.png", Buffer.from(shot.result.data, "base64"));

server.close();
await fetch(`${cdp}/json/close/${target.id}`).catch(() => {});
if (!painted.includes(`${sentinel}_42`)) {
  console.error("FAIL: cloudterm did not paint the real pty output");
  console.error(`last probe: ${lastProbe}`);
  process.exit(1);
}
if (!/\$ |# /.test(painted)) { console.error("FAIL: no shell prompt was painted"); process.exit(1); }
console.log("ok: cloudterm painted real deployed pty output, sentinel and prompt visible");
process.exit(0);
