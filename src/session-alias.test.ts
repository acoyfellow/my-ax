import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveSessionAlias, type AliasDb } from "./session-alias";

const fake = (row: { id: string } | null): AliasDb => ({ prepare: () => ({ bind: () => ({ first: async <T,>() => row as T | null }) }) });

test("root resolves", async () => assert.equal(await resolveSessionAlias(fake({ id: "r1" }), "a@b.c", "root"), "r1"));
test("root missing errors", async () => assert.rejects(resolveSessionAlias(fake(null), "a@b.c", "root"), /root session/));
test("other ids pass through", async () => assert.equal(await resolveSessionAlias(fake(null), "a@b.c", "abc"), "abc"));
test("paint-ring guards on paintWorklet", () => assert.match(readFileSync(new URL("./ui/paint-ring.ts", import.meta.url), "utf8"), /"paintWorklet" in CSS/));
