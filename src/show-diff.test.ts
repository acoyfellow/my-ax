import assert from "node:assert/strict";
import test from "node:test";
import { createVerifiedCodeDiffReceipt } from "./code-diff-read";
test("verified diff reads use server readers instead of model-supplied text", async () => {
  const reads: string[] = [];
  const receipt = await createVerifiedCodeDiffReceipt({
    old: { source: "workspace", path: "/home/user/previous.ts" },
    new: { source: "workspace", path: "/home/user/current.ts" },
    path: "src/current.ts",
  }, {
    readWorkspace: async (path) => {
      reads.push(path);
      return path.endsWith("previous.ts") ? "export const value = 1;\n" : "export const value = 2;\n";
    },
    readMachine: async () => "",
  });

  assert.deepEqual(reads, ["/home/user/previous.ts", "/home/user/current.ts"]);
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
