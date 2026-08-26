import WebSocket from "ws";

const host = process.env.MYAX_HOST;
const token = process.env.MYAX_TOKEN;
const canary = process.env.MYAX_CANARY;
if (!host || !token || !canary) {
  console.error("FAIL: MYAX_HOST, MYAX_TOKEN and MYAX_CANARY are required");
  process.exit(1);
}

const url = `${host.replace(/^https:/, "wss:")}/api/workspace/terminal?cols=80&rows=24`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { "cf-access-token": token } });
    const timer = setTimeout(() => reject(new Error("pty upgrade timed out")), 45_000);
    socket.on("open", () => { clearTimeout(timer); resolve(socket); });
    socket.on("unexpected-response", (_req, res) => { clearTimeout(timer); reject(new Error(`pty upgrade answered ${res.statusCode}`)); });
    socket.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

function transcriptOf(socket) {
  const box = { text: "", binaryFrames: 0 };
  socket.on("message", (data, isBinary) => {
    if (isBinary) box.binaryFrames += 1;
    box.text += data.toString("utf8");
  });
  return box;
}

function type(socket, text) {
  socket.send(Buffer.from(text, "utf8"), { binary: true });
}

const failures = [];
const check = (label, condition) => {
  console.log(`${condition ? "ok" : "FAIL"}: ${label}`);
  if (!condition) failures.push(label);
};

const first = await connect();
const firstOut = transcriptOf(first);
await wait(1500);
check("the pty announces itself ready", firstOut.text.includes('"type":"ready"'));
check("the shell paints a prompt", /\$ |# /.test(firstOut.text));

type(first, `echo ${canary}_$((6*7))\n`);
await wait(2500);
check("a typed command executes in a real shell", firstOut.text.includes(`${canary}_42`));
check("pty output arrives as binary frames", firstOut.binaryFrames > 0);

type(first, `export PTY_GATE_MARKER=${canary}_marker\n`);
await wait(1200);

first.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
await wait(800);
type(first, "stty size\n");
await wait(2000);
check("a resize control frame changes the tty size", /40 120/.test(firstOut.text));
check("a valid control frame is not rejected", !firstOut.text.includes("Invalid control message"));

first.close();
await wait(3000);

const second = await connect();
const secondOut = transcriptOf(second);
await wait(1800);
check("a reconnect replays buffered scrollback", secondOut.text.length > 0);
type(second, "echo survived:$PTY_GATE_MARKER\n");
await wait(2500);
check("the same shell process survives a reconnect", secondOut.text.includes(`survived:${canary}_marker`));
second.close();

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} live pty assertion(s) failed`);
  process.exit(1);
}
console.log("ok: the live pty proved typing, resize, and reconnect survival");
process.exit(0);
