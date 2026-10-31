import assert from "node:assert/strict";
import test from "node:test";
import { widgetWording } from "./widget-names";

test("widget wording renames prose but keeps protocol frame names the host speaks", () => {
  const out = widgetWording("Create an artifact. Post { type: 'my-ax:artifact-submit' } or 'my-ax:artifact-register' from the svelte-artifact frame.");
  assert.match(out, /Create a widget\./);
  assert.match(out, /my-ax:artifact-submit/);
  assert.match(out, /my-ax:artifact-register/);
  assert.match(out, /svelte-artifact frame/);
  assert.doesNotMatch(out, /my-ax:widget-/);
});
