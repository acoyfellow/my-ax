import assert from "node:assert/strict";
import { test } from "node:test";
import { copiedStyles, documentPip, mirroredAttributes } from "./root-pip";

test("pop-out is offered only where Document Picture-in-Picture exists", () => {
  assert.equal(documentPip({}), null);
  assert.equal(documentPip(null), null);
  assert.equal(documentPip({ documentPictureInPicture: {} }), null);
  const api = { requestWindow: async () => ({}) as Window, window: null };
  assert.equal(documentPip({ documentPictureInPicture: api }), api);
});

test("readable sheets are inlined and cross-origin sheets are linked", () => {
  const blocked = { href: "https://cdn.example/x.css", get cssRules(): ArrayLike<{ cssText: string }> { throw new Error("SecurityError"); } };
  const copies = copiedStyles([{ href: null, cssRules: [{ cssText: ".a{}" }, { cssText: ".b{}" }] }, blocked]);
  assert.deepEqual(copies, [{ kind: "inline", css: ".a{}\n.b{}" }, { kind: "link", href: "https://cdn.example/x.css" }]);
});

test("the theme on the page root carries into the pop-out", () => {
  const attrs: Record<string, string> = { class: "dark", "data-theme": "dark", id: "x" };
  assert.deepEqual(mirroredAttributes({ getAttribute: (name) => attrs[name] ?? null }), [["class", "dark"], ["data-theme", "dark"]]);
});
