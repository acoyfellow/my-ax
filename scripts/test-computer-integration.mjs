import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = join(root, "wrangler.computer-integration.jsonc");
const ownerA = "owner-a@example.test";
const ownerB = "owner-b@example.test";
const path = "/home/user/proof/exact.txt";
const content = "persisted UTF-8 bytes:\nπ=3.14159\nemoji=🙂\n";
const expectedBytes = Buffer.from(content, "utf8");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function processOutput(workerProcess) {
  const output = [];
  workerProcess.stdout.on("data", (chunk) => output.push(String(chunk)));
  workerProcess.stderr.on("data", (chunk) => output.push(String(chunk)));
  return () => output.join("");
}

async function waitForReady(baseUrl, workerProcess, output) {
  const deadline = Date.now() + 60_000;
  let exited = workerProcess.exitCode !== null || workerProcess.signalCode !== null;
  workerProcess.once("exit", () => { exited = true; });
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Wrangler exited before the integration Worker was ready.\n${output()}`);
    try {
      const response = await fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for the integration Worker.\n${output()}`);
}

async function startWorker(port, persistencePath) {
  const workerProcess = spawn(process.execPath, [
    wrangler,
    "dev",
    "--config", config,
    "--local",
    "--persist-to", persistencePath,
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--log-level", "error",
    "--show-interactive-dev-session=false",
  ], {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = processOutput(workerProcess);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(baseUrl, workerProcess, output);
  return { process: workerProcess, output, baseUrl };
}

async function stopWorker(workerProcess, output) {
  if (workerProcess.exitCode !== null || workerProcess.signalCode !== null) return;
  const exited = new Promise((resolve) => workerProcess.once("exit", resolve));
  workerProcess.kill("SIGTERM");
  await Promise.race([exited, delay(15_000)]);
  if (workerProcess.exitCode === null && workerProcess.signalCode === null) {
    workerProcess.kill("SIGKILL");
    await exited;
  }
  if (workerProcess.exitCode !== 0 && workerProcess.signalCode !== "SIGTERM") {
    throw new Error(`Wrangler stopped unexpectedly.\n${output()}`);
  }
}

async function request(baseUrl, pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

async function responseJson(response) {
  return response.json();
}

function assertByteExact(value) {
  assert.equal(value.content, content);
  assert.deepEqual(Buffer.from(value.content, "utf8"), expectedBytes);
  assert.equal(value.bytes, expectedBytes.byteLength);
}

async function writeOwnerA(baseUrl) {
  const response = await request(baseUrl, "/write", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner: ownerA, path, content }),
  });
  assert.equal(response.status, 200);
  const value = await responseJson(response);
  assert.deepEqual(value, { path, bytesWritten: expectedBytes.byteLength });
}

async function readOwner(baseUrl, owner) {
  const parameters = new URLSearchParams({ owner, path });
  return request(baseUrl, `/read?${parameters}`);
}

async function proveBoundedWrite(baseUrl) {
  const response = await request(baseUrl, "/write", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner: ownerA, path: "/home/user/proof/too-large.txt", content: "x".repeat(32 * 1024 + 1) }),
  });
  assert.equal(response.status, 400);
  const value = await responseJson(response);
  assert.match(value.error, /Computer content must be at most 32768 bytes/);
}

async function proveOwnerIsolation(baseUrl) {
  const response = await readOwner(baseUrl, ownerB);
  assert.equal(response.status, 400);
  const value = await responseJson(response);
  assert.match(value.error, /Computer path does not exist/);
  assert.equal(JSON.stringify(value).includes(content), false);
}

async function proveHealth(baseUrl) {
  const response = await request(baseUrl, `/health?${new URLSearchParams({ owner: ownerA })}`);
  assert.equal(response.status, 200);
  const value = await responseJson(response);
  assert.equal(value.ownerScoped, true);
  assert.equal(value.homeReady, true);
  assert.equal(value.storage, "durable-object-sqlite");
  assert.deepEqual(value.executionBackends, []);
  assert.equal(value.quotas.files, 512);
  assert.equal(value.quotas.storageBytes, 4 * 1024 * 1024);
}

const persistencePath = await mkdtemp(join(tmpdir(), "my-ax-computer-integration-"));
let first;
let second;
try {
  const port = await availablePort();
  first = await startWorker(port, persistencePath);
  await writeOwnerA(first.baseUrl);
  const reopened = await readOwner(first.baseUrl, ownerA);
  assert.equal(reopened.status, 200);
  assertByteExact(await responseJson(reopened));
  await proveBoundedWrite(first.baseUrl);
  const afterBoundedFailure = await readOwner(first.baseUrl, ownerA);
  assert.equal(afterBoundedFailure.status, 200);
  assertByteExact(await responseJson(afterBoundedFailure));
  await proveOwnerIsolation(first.baseUrl);
  await proveHealth(first.baseUrl);
  await stopWorker(first.process, first.output);
  first = undefined;
  second = await startWorker(port, persistencePath);
  const afterRestart = await readOwner(second.baseUrl, ownerA);
  assert.equal(afterRestart.status, 200);
  assertByteExact(await responseJson(afterRestart));
  await proveOwnerIsolation(second.baseUrl);
  console.log("Computer Durable Object integration proof passed.");
} finally {
  if (first) await stopWorker(first.process, first.output);
  if (second) await stopWorker(second.process, second.output);
  await rm(persistencePath, { recursive: true, force: true });
}
