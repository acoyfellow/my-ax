import assert from "node:assert/strict";
import test from "node:test";
import { createAITools } from "@cloudflare/computer/tools/ai-sdk";
import type { FileInfo } from "@cloudflare/shell";
import { thinkWorkspaceFor, type WorkspaceLike } from "./think-workspace-fs";

function info(path: string, type: FileInfo["type"], size = 0): FileInfo {
  return { path, name: path.slice(path.lastIndexOf("/") + 1), type, mimeType: "text/plain", size, createdAt: 1, updatedAt: 2 };
}

function memoryWorkspace(files: Map<string, string>): WorkspaceLike {
  const isDir = (path: string) => path === "/home/user" || [...files.keys()].some((file) => file.startsWith(`${path}/`));
  return {
    async readFile(path) { return files.get(path) ?? null; },
    async readFileBytes(path) { const text = files.get(path); return text === undefined ? null : new TextEncoder().encode(text); },
    async writeFile(path, content) { files.set(path, content); },
    async mkdir() {},
    async readDir(dir) {
      const names = new Set([...files.keys()].filter((file) => file.startsWith(`${dir}/`)).map((file) => file.slice(dir.length + 1).split("/")[0]));
      return [...names].sort().map((name) => (files.has(`${dir}/${name}`) ? info(`${dir}/${name}`, "file", files.get(`${dir}/${name}`)!.length) : info(`${dir}/${name}`, "directory")));
    },
    async glob(pattern) {
      const prefix = pattern.replace(/\/\*\*.*$/, "");
      return [...files.keys()].filter((file) => file.startsWith(`${prefix}/`)).map((file) => info(file, "file", files.get(file)!.length));
    },
    async stat(path) {
      if (files.has(path)) return info(path, "file", files.get(path)!.length);
      return isDir(path) ? info(path, "directory") : null;
    },
    async rm(path) { files.delete(path); },
  };
}

test("Think's fs reads stream bytes and signals missing files with ENOENT", async () => {
  const workspace = thinkWorkspaceFor(memoryWorkspace(new Map([["/home/user/a.txt", "hello"]])));
  assert.equal(await workspace.fs.readFile("/home/user/a.txt", "utf8"), "hello");
  const stream = await workspace.fs.readFile("/home/user/a.txt");
  assert.equal(await new Response(stream).text(), "hello");
  await assert.rejects(workspace.fs.readFile("/home/user/missing.txt", "utf8"), { code: "ENOENT" });
  await assert.rejects(workspace.fs.stat("/home/user/missing.txt"), { code: "ENOENT" });
});

test("Think's fs writes bytes and lists directory entries as dirents", async () => {
  const files = new Map([["/home/user/src/x.ts", "x"]]);
  const workspace = thinkWorkspaceFor(memoryWorkspace(files));
  await workspace.fs.writeFile("/home/user/b.txt", new TextEncoder().encode("bee"));
  assert.equal(files.get("/home/user/b.txt"), "bee");
  const entries = await workspace.fs.readdir("/home/user");
  assert.deepEqual(entries.map((entry) => [entry.name, entry.isDirectory, entry.isFile]), [["b.txt", false, true], ["src", true, false]]);
});

test("Think's fs greps file contents with line numbers", async () => {
  const workspace = thinkWorkspaceFor(memoryWorkspace(new Map([["/home/user/src/x.ts", "one\nTODO two\nthree"]])));
  const matches = await workspace.fs.grep("todo", "/home/user/src", { ignoreCase: true });
  assert.deepEqual(matches.map((match) => [match.path, match.line, match.text]), [["/home/user/src/x.ts", 2, "TODO two"]]);
});

test("the workspace yields Think's file tools and no exec tool", () => {
  const tools = createAITools({ workspace: thinkWorkspaceFor(memoryWorkspace(new Map())) });
  assert.deepEqual(Object.keys(tools).sort(), ["delete", "edit", "find", "grep", "ls", "read", "write"]);
});
