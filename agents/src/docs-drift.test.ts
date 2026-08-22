import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..", "..");
const readme = readFileSync(join(root, "agents", "README.md"), "utf8");

test("every proof gate is named in the factory README", () => {
  const gates = readdirSync(join(root, "proof")).filter((name) => name.endsWith(".sh"));
  assert.ok(gates.length > 0, "there must be at least one proof gate");
  for (const gate of gates) {
    assert.ok(
      readme.includes(gate),
      `proof/${gate} is not named in agents/README.md; a gate nobody documents is a gate nobody runs`,
    );
  }
});

test("the README does not claim triage needs a pre-existing branch", () => {
  assert.doesNotMatch(
    readme,
    /and `bot\/issue-<n>` exists/,
    "triage creates the branch now; the README must not say it must already exist",
  );
});

test("the README describes the sweep queue rule that is in the code", () => {
  const sweep = readFileSync(join(root, "agents", "src", "sweep.ts"), "utf8");
  assert.match(sweep, /if \(issue\.hasOpenPr\) continue;/, "the sweep must skip issues with an open PR");
  assert.match(readme, /no open PR/, "the README must say the sweep skips issues with an open PR");
  assert.doesNotMatch(
    readme,
    /queue issues with no board or with a head/,
    "that clause was the re-queue loop; it must not be documented as intended",
  );
});
