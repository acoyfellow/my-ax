import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COMPUTER_GREP_MAX_MATCHES,
  COMPUTER_LIST_MAX_ENTRIES,
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

function filesystem(nodes: Record<string, Node>, grepMatches: Array<{ path: string; line: number; text: string }> = []) {
  const entries = new Map(Object.entries(nodes));
  const writes: Array<{ path: string; content: string }> = [];
  const fs: ComputerFilesystem = {
    async lstat(path) {
      const node = entries.get(path);
      if (!node) {
        const error = new Error("ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      }
      return node;
    },
    async readFile(path) {
      const node = entries.get(path);
      if (!node?.isFile) {
        const error = new Error("ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      }
      return node.content ?? "";
    },
    async readdir() {
      return [];
    },
    async grep() {
      return grepMatches;
    },
    async writeFile(path, content) {
      writes.push({ path, content });
      entries.set(path, { size: new TextEncoder().encode(content).byteLength, isFile: true, isDirectory: false, isSymbolicLink: false, content });
    },
    async mkdir(path) {
      if (!entries.has(path)) entries.set(path, { size: 0, isFile: false, isDirectory: true, isSymbolicLink: false });
    },
  };
  return { fs, writes };
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

test("Computer writes enforce byte bounds and reject symlink parents", async () => {
  const oversized = filesystem(baseNodes());
  await assert.rejects(
    () => writeComputerFileFromWorkspace({ fs: oversized.fs }, { path: "/home/user/note.txt", content: "x".repeat(COMPUTER_WRITE_MAX_BYTES + 1) }),
    /content must be at most/,
  );
  assert.equal(oversized.writes.length, 0);

  const nodes = baseNodes();
  nodes["/home/user/link"] = { size: 0, isFile: false, isDirectory: false, isSymbolicLink: true };
  const linked = filesystem(nodes);
  await assert.rejects(
    () => writeComputerFileFromWorkspace({ fs: linked.fs }, { path: "/home/user/link/note.txt", content: "safe" }),
    /symbolic links/,
  );
  assert.equal(linked.writes.length, 0);
});

test("Computer grep bounds matches and refuses symlink match paths", async () => {
  const nodes = baseNodes();
  const matches = Array.from({ length: COMPUTER_GREP_MAX_MATCHES + 5 }, (_, index) => {
    const path = `/home/user/note-${index}.txt`;
    nodes[path] = { size: 5, isFile: true, isDirectory: false, isSymbolicLink: false, content: "match" };
    return { path, line: index + 1, text: "match" };
  });
  const result = await grepComputerFilesFromWorkspace({ fs: filesystem(nodes, matches).fs }, { path: "/home/user", query: "match" });
  assert.equal((result.matches as unknown[]).length, COMPUTER_GREP_MAX_MATCHES);
  assert.equal(result.truncated, true);
  const longText = await grepComputerFilesFromWorkspace(
    { fs: filesystem(nodes, [{ path: "/home/user/note-0.txt", line: 1, text: "x".repeat(700) }]).fs },
    { query: "match" },
  );
  assert.ok(((longText.matches as Array<{ text: string }>)[0].text.length) < 700);

  nodes["/home/user/link.txt"] = { size: 0, isFile: false, isDirectory: false, isSymbolicLink: true };
  await assert.rejects(
    () => grepComputerFilesFromWorkspace({ fs: filesystem(nodes, [{ path: "/home/user/link.txt", line: 1, text: "match" }]).fs }, { query: "match" }),
    /symbolic links/,
  );
});

test("Computer work methods are cataloged, capability-instrumented, and bound into code mode", () => {
  const source = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");
  assert.match(source, /COMPUTER_WORK_METHODS\.map\(\(method\) => catalogEntry\("computer"/);
  assert.match(source, /instrument\("computer", restrictByCapabilities\("computer", checkedComputerProvider/);
  assert.match(source, /namespace\("computer", Object\.keys\(computerFns\)\)/);
  assert.match(source, /computer:globalThis\.computer/);
});

test("Computer-only work code does not classify as a Sandbox snapshot mutation", () => {
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify({ calls: [{ where: "computer", method: "write", status: "ok" }] })), false);
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify({ calls: [{ where: "workspace", method: "write", status: "ok" }] })), true);
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", "not-json"), true);
});

test("Computer binding and append-only migration exist in production and dev", () => {
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.equal((wrangler.match(/"name": "COMPUTER", "class_name": "ComputerWorkspace"/g) ?? []).length, 2);
  assert.equal((wrangler.match(/"tag": "v11-computer-workspace", "new_sqlite_classes": \["ComputerWorkspace"\]/g) ?? []).length, 2);
  const index = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  assert.match(index, /export \{ ComputerWorkspace \} from "\.\/computer-workspace"/);
  const systemRoutes = readFileSync(new URL("./routes/system.ts", import.meta.url), "utf8");
  assert.match(systemRoutes, /app\.get\("\/api\/system\/computer"/);
  assert.match(systemRoutes, /getComputerHealth\(c\.env, c\.get\("identity"\)\)/);
});
