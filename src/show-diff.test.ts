import assert from "node:assert/strict";
import test from "node:test";
import { CODE_DIFF_MAX_TEXT_BYTES } from "./code-diff";
import { createVerifiedCodeDiffReceipt } from "./code-diff-read";
import { readBoundedWorkspaceFile } from "./workspace-read";
test("verified diff reads use server readers instead of model-supplied text", async () => {
  const reads: string[] = [];
  const readLimits: number[] = [];
  const receipt = await createVerifiedCodeDiffReceipt({
    old: { source: "workspace", path: "/home/user/previous.ts" },
    new: { source: "workspace", path: "/home/user/current.ts" },
    path: "src/current.ts",
  }, {
    readWorkspace: async (path, maxBytes) => {
      reads.push(path);
      readLimits.push(maxBytes);
      return path.endsWith("previous.ts") ? "export const value = 1;\n" : "export const value = 2;\n";
    },
    readMachine: async () => "",
  });

  assert.deepEqual(reads, ["/home/user/previous.ts", "/home/user/current.ts"]);
  assert.deepEqual(readLimits, [CODE_DIFF_MAX_TEXT_BYTES + 1, CODE_DIFF_MAX_TEXT_BYTES + 1]);
  assert.deepEqual(receipt, {
    kind: "code-diff",
    version: 1,
    path: "src/current.ts",
    title: "src/current.ts",
    oldText: "export const value = 1;\n",
    newText: "export const value = 2;\n",
    source: { old: "workspace", new: "workspace" },
  });
});

test("verified diff reads reject self-attested text and unsupported sources", async () => {
  const readers = {
    readWorkspace: async () => "old\n",
    readMachine: async () => "new\n",
  };

  await assert.rejects(
    createVerifiedCodeDiffReceipt({
      old: { source: "workspace", path: "/home/user/old.ts" },
      new: { source: "machine", path: "/Users/owner/new.ts" },
      oldText: "invented old\n",
      path: "src/file.ts",
    }, readers),
    /unsupported fields/,
  );
  await assert.rejects(
    createVerifiedCodeDiffReceipt({
      old: { source: "generated", path: "ignored" },
      new: { source: "machine", path: "/Users/owner/new.ts" },
      path: "src/file.ts",
    }, readers),
    /workspace or machine/,
  );
});

test("bounded workspace reads reject outside symlinks, read in-root files, and preserve byte caps", async () => {
  const commands: string[] = [];
  const outsideLink = "/home/user/outside-link";
  const insideFile = "/home/user/inside.ts";
  const sandbox = {
    exec: async (command: string) => {
      commands.push(command);
      return command.includes(`'${outsideLink}'`)
        ? { exitCode: 1, stdout: "" }
        : { exitCode: 0, stdout: "bounded\n" };
    },
  };

  assert.equal(await readBoundedWorkspaceFile(sandbox, outsideLink, CODE_DIFF_MAX_TEXT_BYTES + 1), null);
  assert.equal(await readBoundedWorkspaceFile(sandbox, insideFile, CODE_DIFF_MAX_TEXT_BYTES + 1), "bounded\n");
  assert.equal(commands.length, 2);
  for (const command of commands) {
    assert.match(command, /exec 3< "\$1"/);
    assert.match(command, /realpath -e -- \/proc\/self\/fd\/3/);
    assert.match(command, /case "\$resolved" in\n  \/home\/user\/\*\) ;;/);
    assert.match(command, new RegExp(`dd if=/proc/self/fd/3 bs=1 count="\\$2" status=none.* ${CODE_DIFF_MAX_TEXT_BYTES + 1}$`));
    assert.ok(command.indexOf("realpath -e") < command.indexOf("dd if=/proc/self/fd/3"));
  }

  const missing = await readBoundedWorkspaceFile({
    exec: async () => ({ exitCode: 1, stdout: "" }),
  }, "/home/user/missing.ts", CODE_DIFF_MAX_TEXT_BYTES + 1);
  assert.equal(missing, null);
});

test("verified diff reads reject missing workspace text instead of treating it as an empty side", async () => {
  await assert.rejects(
    createVerifiedCodeDiffReceipt({
      old: { source: "workspace", path: "/home/user/missing.ts" },
      new: { source: "machine", path: "/Users/owner/new.ts" },
      path: "src/file.ts",
    }, {
      readWorkspace: async () => null,
      readMachine: async () => "new\n",
    }),
    /workspace read did not return text/,
  );
});

test("verified diff reads canonicalize workspace paths and reject paths outside the workspace", async () => {
  const paths: string[] = [];
  const readers = {
    readWorkspace: async (path: string) => {
      paths.push(path);
      return "workspace\n";
    },
    readMachine: async () => "machine\n",
  };
  await createVerifiedCodeDiffReceipt({
    old: { source: "workspace", path: "//home//user//src//current.ts" },
    new: { source: "machine", path: "/Users/owner/current.ts" },
    path: "src/current.ts",
  }, readers);
  assert.deepEqual(paths, ["/home/user/src/current.ts"]);

  for (const path of ["/etc/passwd", "/home/user/../secrets.txt", "../secrets.txt"]) {
    await assert.rejects(
      createVerifiedCodeDiffReceipt({
        old: { source: "workspace", path },
        new: { source: "machine", path: "/Users/owner/current.ts" },
        path: "src/current.ts",
      }, readers),
      /inside \/home\/user|traversal/,
    );
  }
});

test("verified diff reads preserve machine provenance only after the machine reader returns text", async () => {
  const receipt = await createVerifiedCodeDiffReceipt({
    old: { source: "workspace", path: "/home/user/file.ts" },
    new: { source: "machine", path: "/Users/owner/file.ts" },
    path: "src/file.ts",
  }, {
    readWorkspace: async () => "export const answer = 41;\n",
    readMachine: async () => "export const answer = 42;\n",
  });

  assert.equal(receipt.source.new, "machine");
  assert.equal(receipt.newText, "export const answer = 42;\n");
  await assert.rejects(
    createVerifiedCodeDiffReceipt({
      old: { source: "workspace", path: "/home/user/file.ts" },
      new: { source: "machine", path: "/Users/owner/file.ts" },
      path: "src/file.ts",
    }, {
      readWorkspace: async () => "old\n",
      readMachine: async () => undefined as unknown as string,
    }),
    /machine read did not return text/,
  );
});
