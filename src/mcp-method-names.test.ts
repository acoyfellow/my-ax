import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";


const source = readFileSync(join(import.meta.dirname, "routes", "mcp.ts"), "utf8");

function codeMethodKeys(): string[] {
  const block = source.match(/const CODE_METHODS: Record<string, Method> = \{([\s\S]*?)\n\};/);
  assert.ok(block, "CODE_METHODS must exist");
  return [...block[1].matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((match) => match[1]);
}

function declaredTypeNames(): string[] {
  const block = source.match(/const CODE_TYPES = `declare const codemode: \{([\s\S]*?)\n\}/);
  assert.ok(block, "CODE_TYPES must exist");
  return [...block[1].matchAll(/([A-Za-z0-9_]+)\((?:args)?[?:)]/g)].map((match) => match[1]);
}

test("my_ax_code wraps bare listSessions so agents do not need codemode.", () => {
  assert.match(source, /export function wrapCoordinatorCode/);
  assert.match(source, /bcodemode/);
  assert.match(source, /} = codemode/);
});

test("the runtime advertises the names it can actually dispatch", () => {
  assert.match(
    source,
    /availableMethods: CODE_METHOD_NAMES/,
    "availableMethods must report the callable codemode names, not the internal wire names",
  );
});

test("every advertised name is a real dispatch key", () => {
  const keys = new Set(codeMethodKeys());
  for (const name of declaredTypeNames()) {
    assert.ok(keys.has(name), `CODE_TYPES declares ${name}() but CODE_METHODS cannot dispatch it`);
  }
});

test("every dispatch key is documented in the type surface", () => {
  const declared = new Set(declaredTypeNames());
  for (const key of codeMethodKeys()) {
    assert.ok(declared.has(key), `CODE_METHODS exposes ${key} but CODE_TYPES never declares it`);
  }
});

test("the advertised names are camelCase, matching the callable surface", () => {
  for (const key of codeMethodKeys()) {
    assert.ok(!key.includes("_"), `${key} must be camelCase; a caller cannot invoke a snake_case name`);
  }
});
