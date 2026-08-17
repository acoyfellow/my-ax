import assert from "node:assert/strict";
import test from "node:test";
import { attentionSourceLabel, isExternalSourceHref } from "./source-href";

const here = "https://app.example/?session=current";

test("a root href is not an Open source button", () => {
  assert.equal(attentionSourceLabel("/", here), null);
  assert.equal(attentionSourceLabel(null, here), null);
});

test("gitlab and github https links are Open source", () => {
  assert.equal(isExternalSourceHref("https://gitlab.cfdata.org/cloudflare/fe/stratus/-/merge_requests/571"), true);
  assert.equal(attentionSourceLabel("https://gitlab.cfdata.org/cloudflare/fe/stratus/-/merge_requests/571", here), "Open source");
  assert.equal(isExternalSourceHref("https://evil.example/phish"), false);
  assert.equal(isExternalSourceHref("javascript:alert(1)"), false);
});

test("session and run hrefs keep their labels", () => {
  assert.equal(attentionSourceLabel("/?session=abc", here), "Open conversation");
  assert.equal(attentionSourceLabel("/runs/run-1", here), "Open run");
});
