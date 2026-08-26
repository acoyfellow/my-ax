import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ARTIFACT_THEME_CSS } from "./artifact-theme";
import { ARTIFACT_RUNTIME_JS } from "./artifact-runtime";

test("the theme defines the app's real brand tokens, not browser defaults", () => {
  for (const token of ["--bg", "--fg", "--brand", "--line", "--surface-1", "--good", "--bad"]) {
    assert.match(ARTIFACT_THEME_CSS, new RegExp(`${token}:`), `missing token ${token}`);
  }
  assert.match(ARTIFACT_THEME_CSS, /#f6821f/, "the dark brand colour must be the real one");
});

test("a light theme exists so the desk follows the owner's choice", () => {
  assert.match(ARTIFACT_THEME_CSS, /\[data-theme="light"\]/);
  assert.match(ARTIFACT_THEME_CSS, /#c4640d/);
});

test("buttons, inputs, and forms are styled so an agent gets real controls", () => {
  for (const selector of ["button", "input", "textarea", "select", "label", "table"]) {
    assert.match(ARTIFACT_THEME_CSS, new RegExp(`(^|[,\\s])${selector}[,\\s{]`, "m"), `no styling for ${selector}`);
  }
  assert.match(ARTIFACT_THEME_CSS, /\.btn-primary|button\.primary/);
});

test("layout and status utilities exist so agents do not reinvent them", () => {
  for (const cls of [".row", ".col", ".card", ".pill", ".stack", ".truncate", ".between"]) {
    assert.ok(ARTIFACT_THEME_CSS.includes(cls), `missing utility ${cls}`);
  }
});

test("the runtime applies a theme pushed from the host", () => {
  assert.match(ARTIFACT_RUNTIME_JS, /my-ax:artifact-theme/);
  assert.match(ARTIFACT_RUNTIME_JS, /data-theme/);
});

test("the theme needs no third-party stylesheet, so the CSP stays closed", () => {
  assert.doesNotMatch(ARTIFACT_THEME_CSS, /@import/);
  assert.doesNotMatch(ARTIFACT_THEME_CSS, /https?:\/\//);
});

test("the preview shell injects the theme before the artifact's own css", () => {
  const routes = readFileSync(new URL("./routes/artifacts.ts", import.meta.url), "utf8");
  const styleLine = routes.split("\n").find((l) => l.includes("<style>")) ?? "";
  assert.match(styleLine, /\$\{ARTIFACT_THEME_CSS\}/, "the theme is not injected into the preview shell");
  assert.ok(
    styleLine.indexOf("ARTIFACT_THEME_CSS") < styleLine.indexOf("${css}"),
    "the artifact's own css must come last so it can override the theme",
  );
  assert.doesNotMatch(styleLine, /background:#0a0a0a/, "the hardcoded off-theme background should be gone");
});
