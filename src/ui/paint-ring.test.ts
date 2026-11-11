import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./paint-ring.ts", import.meta.url), "utf8");

test("paint-ring guards on paintWorklet in CSS", () => assert.match(source, /"paintWorklet" in CSS/));
test("paint-ring loads the same-origin worklet", () => assert.match(source, /\/static\/worklets\/status-ring\.js/));
