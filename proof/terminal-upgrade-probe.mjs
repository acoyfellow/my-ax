import WebSocket from "ws";

const host = process.env.MYAX_HOST;
const token = process.env.MYAX_TOKEN;
if (!host || !token) {
  console.error("FAIL: MYAX_HOST and MYAX_TOKEN are required");
  process.exit(1);
}

const socket = new WebSocket(`${host.replace(/^https:/, "wss:")}/api/workspace/terminal?cols=80&rows=24`, {
  headers: { "cf-access-token": token },
});

let upgraded = false;
const finish = (message, code) => {
  console.log(message);
  try { socket.close(); } catch {}
  process.exit(code);
};

setTimeout(() => finish("FAIL: the terminal endpoint never upgraded", 1), 60_000);
socket.on("upgrade", (res) => { upgraded = res.statusCode === 101; });
socket.on("unexpected-response", (_req, res) => finish(`FAIL: the terminal endpoint answered ${res.statusCode}`, 1));
socket.on("error", (err) => finish(`FAIL: ${String(err.message).slice(0, 120)}`, 1));
socket.on("message", (data, isBinary) => {
  if (!isBinary) return;
  if (!upgraded) return finish("FAIL: pty bytes arrived without a 101 upgrade", 1);
  finish("ok: the terminal endpoint upgraded (101) and a live pty sent binary output", 0);
});
