import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COMPUTER_GREP_MAX_MATCHES,
  COMPUTER_LIST_MAX_ENTRIES,
  COMPUTER_OWNER_MAX_FILES,
  COMPUTER_OWNER_MAX_STORAGE_BYTES,
  COMPUTER_READ_MAX_BYTES,
  COMPUTER_WRITE_MAX_BYTES,
  grepComputerFilesFromWorkspace,
  listComputerFilesFromWorkspace,
  readComputerFileFromWorkspace,
  resolveComputerPath,
  withComputerWorkspace,
  writeComputerFileFromWorkspace,
  type ComputerFilesystem,
} from "./computer-filesystem";
import { computerWorkspaceName } from "./computer-owner";
import { shouldSnapshotSandboxForToolCall } from "./workspace-snapshot-classification";

type Node = {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  content?: string;
};

function filesystem(nodes: Record<string, Node>) {
  const entries = new Map(Object.entries(nodes));
  const writes: Array<{ path: string; content: string }> = [];
  const readPaths: string[] = [];
  const lstatPaths: string[] = [];
  const mkdirPaths: string[] = [];
  const fs: ComputerFilesystem = {
    async lstat(path) {
      lstatPaths.push(path);
      const node = entries.get(path);
      if (!node) {
        const error = new Error("ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      }
      return node;
    },
    async readFile(path) {
      readPaths.push(path);
      const node = entries.get(path);
      if (!node?.isFile) {
        const error = new Error("ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      }
      return node.content ?? "";
    },
    async readdir(path) {
      const prefix = `${path}/`;
      return [...entries.entries()]
        .filter(([candidate]) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/"))
        .map(([candidate, node]) => ({
          name: candidate.slice(prefix.length),
          isFile: node.isFile,
          isDirectory: node.isDirectory,
          isSymbolicLink: node.isSymbolicLink,
        }));
    },
    async writeFile(path, content) {
      writes.push({ path, content });
      entries.set(path, { size: new TextEncoder().encode(content).byteLength, isFile: true, isDirectory: false, isSymbolicLink: false, content });
    },
    async mkdir(path) {
      mkdirPaths.push(path);
      if (!entries.has(path)) entries.set(path, { size: 0, isFile: false, isDirectory: true, isSymbolicLink: false });
    },
  };
  return { fs, writes, readPaths, lstatPaths, mkdirPaths, entries };
}

function baseNodes(): Record<string, Node> {
  return {
    "/home": { size: 0, isFile: false, isDirectory: true, isSymbolicLink: false },
    "/home/user": { size: 0, isFile: false, isDirectory: true, isSymbolicLink: false },
  };
}

test("Computer owner routing uses the normalized verified Access email", () => {
  assert.equal(computerWorkspaceName({ email: " Owner@Example.COM " }), "owner@example.com");
  assert.throws(() => computerWorkspaceName({ email: "   " }), /verified owner email/);
  const source = readFileSync(new URL("./computer-workspace.ts", import.meta.url), "utf8");
  assert.match(source, /COMPUTER\.idFromName\(computerWorkspaceName\(identity\)\)/);
});

test("Computer paths remain strictly contained under /home/user", () => {
  assert.equal(resolveComputerPath("/home/user/notes.txt"), "/home/user/notes.txt");
  assert.equal(resolveComputerPath("/home/user/"), "/home/user");
  for (const path of ["notes.txt", "/tmp/notes.txt", "/home/user/../secret", "/home/user/a/./b", "/home/user\0bad"]) {
    assert.throws(() => resolveComputerPath(path), /Computer path/);
  }
});

test("Computer workspace clients are disposed after success and failure", async () => {
  let disposed = 0;
  const workspace = { fs: {} as ComputerFilesystem, [Symbol.dispose]: () => { disposed++; } };
  const value = await withComputerWorkspace(async () => workspace, async () => "ok");
  assert.equal(value, "ok");
  assert.equal(disposed, 1);
  await assert.rejects(
    () => withComputerWorkspace(async () => workspace, async () => { throw new Error("fail"); }),
    /fail/,
  );
  assert.equal(disposed, 2);
});

test("Computer reads reject oversized files before loading content", async () => {
  const nodes = baseNodes();
  nodes["/home/user/large.txt"] = { size: COMPUTER_READ_MAX_BYTES + 1, isFile: true, isDirectory: false, isSymbolicLink: false, content: "unread" };
  const fixture = filesystem(nodes);
  await assert.rejects(
    () => readComputerFileFromWorkspace({ fs: fixture.fs }, { path: "/home/user/large.txt" }),
    /read limit/,
  );
  assert.deepEqual(fixture.readPaths, []);
});

test("Computer listing bounds entry output", async () => {
  const nodes = baseNodes();
  const entries = Array.from({ length: COMPUTER_LIST_MAX_ENTRIES + 8 }, (_, index) => ({
    name: `note-${index}.txt`,
    isFile: true,
    isDirectory: false,
    isSymbolicLink: false,
  }));
  const fixture = filesystem(nodes);
  const result = await listComputerFilesFromWorkspace({ fs: { ...fixture.fs, readdir: async () => entries } }, { path: "/home/user" });
  assert.equal((result.entries as unknown[]).length, COMPUTER_LIST_MAX_ENTRIES);
  assert.equal(result.truncated, true);
});

test("Computer writes enforce byte and owner quotas before writeFile", async () => {
  const oversized = filesystem(baseNodes());
  await assert.rejects(
    () => writeComputerFileFromWorkspace({ fs: oversized.fs }, { path: "/home/user/note.txt", content: "x".repeat(COMPUTER_WRITE_MAX_BYTES + 1) }),
    /content must be at most/,
  );
  assert.equal(oversized.writes.length, 0);

  const linkedNodes = baseNodes();
  linkedNodes["/home/user/link"] = { size: 0, isFile: false, isDirectory: false, isSymbolicLink: true };
  const linked = filesystem(linkedNodes);
  await assert.rejects(
    () => writeComputerFileFromWorkspace({ fs: linked.fs }, { path: "/home/user/link/note.txt", content: "safe" }),
    /symbolic links/,
  );
  assert.equal(linked.writes.length, 0);

  const fileQuotaNodes = baseNodes();
  for (let index = 0; index < COMPUTER_OWNER_MAX_FILES; index += 1) {
    fileQuotaNodes[`/home/user/file-${index}.txt`] = { size: 0, isFile: true, isDirectory: false, isSymbolicLink: false, content: "" };
  }
  const fileQuota = filesystem(fileQuotaNodes);
  await assert.rejects(
    () => writeComputerFileFromWorkspace({ fs: fileQuota.fs }, { path: "/home/user/one-more.txt", content: "safe" }),
    /file quota/,
  );
  assert.equal(fileQuota.writes.length, 0);

  const storageQuotaNodes = baseNodes();
  storageQuotaNodes["/home/user/full.txt"] = { size: COMPUTER_OWNER_MAX_STORAGE_BYTES, isFile: true, isDirectory: false, isSymbolicLink: false, content: "" };
  const storageQuota = filesystem(storageQuotaNodes);
  await assert.rejects(
    () => writeComputerFileFromWorkspace({ fs: storageQuota.fs }, { path: "/home/user/one-more.txt", content: "safe" }),
    /storage quota/,
  );
  assert.equal(storageQuota.writes.length, 0);
});

test("Computer rejects deep parent creation before any requested-prefix mkdir", async () => {
  const nodes: Record<string, Node> = {
    "/home": { size: 0, isFile: false, isDirectory: true, isSymbolicLink: false },
  };
  const segments = Array.from({ length: 320 }, () => "x");
  const path = `${"/home/user/"}${segments.join("/")}/leaf.txt`;
  const fixture = filesystem(nodes);

  await assert.rejects(
    () => writeComputerFileFromWorkspace({ fs: fixture.fs }, { path, content: "safe" }),
    /directory quota/,
  );

  const requestedParent = path.slice(0, path.lastIndexOf("/"));
  assert.ok(fixture.lstatPaths.includes(requestedParent));
  assert.deepEqual(fixture.mkdirPaths, ["/home/user"]);
  assert.equal(fixture.writes.length, 0);
  assert.deepEqual([...fixture.entries.keys()].sort(), ["/home", "/home/user"]);
});

test("Computer grep host traversal caps matches and prechecks file sizes", async () => {
  const source = readFileSync(new URL("./computer-filesystem.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.fs\.grep\(/);
  assert.match(source, /workspace\.fs\.readdir\(/);
  const nodes = baseNodes();
  for (let index = 0; index < COMPUTER_GREP_MAX_MATCHES + 5; index += 1) {
    nodes[`/home/user/note-${index}.txt`] = { size: 5, isFile: true, isDirectory: false, isSymbolicLink: false, content: "match" };
  }
  const fixture = filesystem(nodes);
  const result = await grepComputerFilesFromWorkspace({ fs: fixture.fs }, { path: "/home/user", query: "match" });
  assert.equal((result.matches as unknown[]).length, COMPUTER_GREP_MAX_MATCHES);
  assert.equal(result.truncated, true);

  nodes["/home/user/long.txt"] = { size: 700, isFile: true, isDirectory: false, isSymbolicLink: false, content: "x".repeat(700) };
  const longText = await grepComputerFilesFromWorkspace({ fs: filesystem(nodes).fs }, { path: "/home/user/long.txt", query: "x" });
  assert.ok(((longText.matches as Array<{ text: string }>)[0].text.length) < 700);

  const precheckedNodes = baseNodes();
  precheckedNodes["/home/user/large.txt"] = { size: COMPUTER_READ_MAX_BYTES + 1, isFile: true, isDirectory: false, isSymbolicLink: false, content: "match" };
  precheckedNodes["/home/user/small.txt"] = { size: 5, isFile: true, isDirectory: false, isSymbolicLink: false, content: "match" };
  const prechecked = filesystem(precheckedNodes);
  const precheckedResult = await grepComputerFilesFromWorkspace({ fs: prechecked.fs }, { query: "match" });
  assert.equal((precheckedResult.matches as unknown[]).length, 1);
  assert.equal(precheckedResult.truncated, true);
  assert.ok(!prechecked.readPaths.includes("/home/user/large.txt"));

  nodes["/home/user/link.txt"] = { size: 0, isFile: false, isDirectory: false, isSymbolicLink: true };
  await assert.rejects(
    () => grepComputerFilesFromWorkspace({ fs: filesystem(nodes).fs }, { path: "/home/user/link.txt", query: "match" }),
    /symbolic links/,
  );
});

test("Computer work methods are cataloged, capability-instrumented, budgeted, and bound into code mode", () => {
  const source = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("./computer-workspace.ts", import.meta.url), "utf8");
  const settings = readFileSync(new URL("./ui/Settings.svelte", import.meta.url), "utf8");
  assert.match(source, /COMPUTER_WORK_METHODS\.map\(\(method\) => catalogEntry\("computer"/);
  assert.match(source, /applyComputerWorkBudget\(checkedComputerProvider\(ctx\)\)/);
  assert.match(source, /instrument\("computer", restrictByCapabilities\("computer"/);
  assert.match(source, /namespace\("computer", Object\.keys\(computerFns\)\)/);
  assert.match(source, /computer:globalThis\.computer/);
  assert.match(settings, /Computer preview/);
  assert.match(settings, /automatic sync/);
  assert.doesNotMatch(workspace, /blockConcurrencyWhile/);
  assert.match(workspace, /#writeTail: Promise<void> = Promise\.resolve\(\)/);
  assert.match(workspace, /this\.serializeWrite\(async \(\) =>/);
  assert.match(workspace, /withReservedComputerRetainedWrite\(this\.ctx\.storage, COMPUTER_RETAINED_WRITE_RESERVATION_BYTES/);
  assert.ok(workspace.indexOf("withReservedComputerRetainedWrite") < workspace.indexOf("writeComputerFileFromWorkspace(workspace, input)"));
  assert.match(workspace, /this\.#writeTail = next\.then\(\(\) => undefined, \(\) => undefined\)/);
  assert.match(workspace, /write: \(input: unknown\) => computer\.write\(input\)/);
});

test("Computer-only work code does not classify as a Sandbox snapshot mutation", () => {
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify({ calls: [{ where: "computer", method: "write", status: "ok" }] })), false);
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify({ calls: [{ where: "workspace", method: "write", status: "ok" }] })), true);
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", "not-json"), true);
});

test("Computer binding, package pin, and append-only migration exist in production and dev", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
  assert.equal(packageJson.dependencies["@cloudflare/computer"], "0.1.1");
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.equal((wrangler.match(/"name": "COMPUTER", "class_name": "ComputerWorkspace"/g) ?? []).length, 2);
  assert.equal((wrangler.match(/"tag": "v11-computer-workspace", "new_sqlite_classes": \["ComputerWorkspace"\]/g) ?? []).length, 2);
  const index = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  assert.match(index, /export \{ ComputerWorkspace \} from "\.\/computer-workspace"/);
  const systemRoutes = readFileSync(new URL("./routes/system.ts", import.meta.url), "utf8");
  assert.match(systemRoutes, /app\.get\("\/api\/system\/computer-workspace"/);
  assert.match(systemRoutes, /getComputerHealth\(c\.env, c\.get\("identity"\)\)/);
});
