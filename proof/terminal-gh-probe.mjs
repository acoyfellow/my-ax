import WebSocket from "ws";

const host = process.env.MYAX_HOST;
const token = process.env.MYAX_TOKEN;
if (!host || !token) {
  console.error("FAIL: MYAX_HOST and MYAX_TOKEN are required");
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
setTimeout(() => { console.error("FAIL: the gh probe exceeded its budget"); process.exit(1); }, 180_000).unref?.();

const socket = new WebSocket(`${host.replace(/^https:/, "wss:")}/api/workspace/terminal?cols=100&rows=30`, {
  headers: { "cf-access-token": token },
});
await new Promise((resolve, reject) => {
  socket.on("open", resolve);
  socket.on("error", reject);
  socket.on("unexpected-response", (_req, res) => reject(new Error(`terminal answered ${res.statusCode}`)));
});

let transcript = "";
socket.on("message", (data, isBinary) => { if (isBinary) transcript += data.toString("utf8"); });
const clean = () => transcript.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "");
await wait(1500);

transcript = "";
socket.send(Buffer.from("command -v gh && gh --version\n", "utf8"), { binary: true });
for (let attempt = 0; attempt < 20 && !/gh version|not found/.test(clean()); attempt += 1) await wait(1500);

const output = clean();
socket.close();

if (!/gh version/.test(output)) {
  console.error("FAIL: gh is not on PATH in the container");
  console.error(output.split("\n").filter((line) => line.trim()).slice(-4).join("\n"));
  process.exit(1);
}
if (/\/home\/user\/\.local\/bin\/gh/.test(output)) {
  console.error("FAIL: gh resolved to a workspace-local copy, which a recycle destroys");
  process.exit(1);
}
console.log(`ok: ${output.match(/gh version [^\r\n]*/)?.[0] ?? "gh present"}`);
process.exit(0);
