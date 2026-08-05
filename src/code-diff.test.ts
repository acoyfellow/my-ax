import assert from "node:assert/strict";
import test from "node:test";
import {
  CODE_DIFF_MAX_TEXT_BYTES,
  CODE_DIFF_MAX_TOTAL_BYTES,
  createCodeDiffReceipt,
  parseCodeDiffReceipt,
} from "./code-diff";
import { limitModelToolOutput, MODEL_TOOL_OUTPUT_LIMIT_BYTES } from "./tool-output-limit";

test("code diff receipts preserve bounded review text and metadata", () => {
  const receipt = createCodeDiffReceipt({
    oldText: "export const answer = 41;\n",
    newText: "export const answer = 42;\n",
    path: "src/answer.ts",
    title: "Answer update",
    language: "typescript",
    source: { old: "workspace", new: "machine" },
  });

  assert.deepEqual(receipt, {
    kind: "code-diff",
    version: 1,
    path: "src/answer.ts",
    title: "Answer update",
    language: "typescript",
    oldText: "export const answer = 41;\n",
    newText: "export const answer = 42;\n",
    source: { old: "workspace", new: "machine" },
  });
});

test("code diff receipts allow an empty side but reject missing and binary payloads", () => {
  const added = createCodeDiffReceipt({
    oldText: "",
    newText: "new file\n",
    path: "src/new.ts",
    source: { old: "workspace", new: "workspace" },
  });

  assert.equal(added.title, "src/new.ts");
  assert.throws(() => createCodeDiffReceipt({
    newText: "new file\n",
    path: "src/new.ts",
    source: { old: "workspace", new: "workspace" },
  }), /oldText is required/);
  assert.throws(() => createCodeDiffReceipt({
    oldText: "binary\u0000payload",
    newText: "new file\n",
    path: "src/new.ts",
    source: { old: "workspace", new: "workspace" },
  }), /binary data/);
  assert.throws(() => createCodeDiffReceipt({
    oldText: "",
    newText: "",
    path: "src/new.ts",
    source: { old: "workspace", new: "workspace" },
  }), /cannot both be empty/);
});

test("code diff receipts reject per-side and total size overflow", () => {
  assert.throws(() => createCodeDiffReceipt({
    oldText: "a".repeat(CODE_DIFF_MAX_TEXT_BYTES + 1),
    newText: "b",
    path: "src/large.ts",
    source: { old: "workspace", new: "workspace" },
  }), /oldText must be <=/);
  assert.throws(() => createCodeDiffReceipt({
    oldText: "a".repeat(CODE_DIFF_MAX_TOTAL_BYTES / 2 + 1),
    newText: "b".repeat(CODE_DIFF_MAX_TOTAL_BYTES / 2 + 1),
    path: "src/large.ts",
    source: { old: "workspace", new: "workspace" },
  }), /combined diff text must be <=/);
});

test("code diff receipts fit model-visible output without truncation", () => {
  const receipt = createCodeDiffReceipt({
    oldText: "",
    newText: "x".repeat(CODE_DIFF_MAX_TOTAL_BYTES),
    path: "src/large.ts",
    source: { old: "workspace", new: "workspace" },
  });
  const output = JSON.stringify(receipt);

  assert.ok(new TextEncoder().encode(output).byteLength <= MODEL_TOOL_OUTPUT_LIMIT_BYTES);
  assert.equal(limitModelToolOutput(output), output);
  assert.throws(() => createCodeDiffReceipt({
    oldText: "\"".repeat(CODE_DIFF_MAX_TOTAL_BYTES - 1),
    newText: "\"",
    path: "src/escaped.ts",
    source: { old: "workspace", new: "workspace" },
  }), /serialized code diff must be <=/);
});

test("code diff receipt parsing fails closed for unsafe paths, metadata, and unknown fields", () => {
  const valid = {
    kind: "code-diff",
    version: 1,
    path: "src/safe.ts",
    title: "Safe diff",
    oldText: "old\n",
    newText: "new\n",
    source: { old: "workspace", new: "machine" },
  } as const;

  assert.equal(parseCodeDiffReceipt(valid)?.kind, "code-diff");
  assert.equal(parseCodeDiffReceipt({ ...valid, path: "../../etc/passwd" }), null);
  assert.equal(parseCodeDiffReceipt({ ...valid, path: "https://evil.example/file.ts" }), null);
  assert.equal(parseCodeDiffReceipt({ ...valid, title: "<img src=x>" }), null);
  assert.equal(parseCodeDiffReceipt({ ...valid, source: { old: "workspace", new: "network" } }), null);
  assert.equal(parseCodeDiffReceipt({ ...valid, html: "<script>alert(1)</script>" }), null);
  assert.equal(parseCodeDiffReceipt({ ...valid, url: "https://evil.example" }), null);
});
