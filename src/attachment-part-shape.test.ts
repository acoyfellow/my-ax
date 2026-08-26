import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sources = [
  "src/agent.ts",
  "src/ui/Chat.svelte",
];

const relativeFilePart = /type:\s*["']file["'][^}]*url:\s*[`"']\/api\/uploads\//;

test("no submit path builds a file part with a relative upload url", () => {
  for (const path of sources) {
    const source = readFileSync(path, "utf8");
    assert.equal(
      relativeFilePart.test(source),
      false,
      `${path} builds a file part with a relative /api/uploads url; the AI SDK calls new URL() on it and the turn dies`,
    );
  }
});

test("both submit paths still carry the attachment as a data-attachment part", () => {
  for (const path of sources) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /type:\s*["']data-attachment["']/, `${path} lost its data-attachment part`);
  }
});
