import assert from "node:assert/strict";
import { test } from "node:test";
import { partReferencesKnownUpload, uploadPathFromPart } from "./attachment-reference";

const uploadPath = "/api/uploads/abc123";

test("matches the url field the submit path actually writes", () => {
  const part = { type: "file", url: uploadPath, mediaType: "image/png", filename: "shot.png" };
  assert.equal(uploadPathFromPart(part), uploadPath);
});

test("still matches a stored part that carries the path in data", () => {
  const part = { type: "file", data: uploadPath, mediaType: "image/png" };
  assert.equal(uploadPathFromPart(part), uploadPath);
});

test("ignores non-file parts", () => {
  assert.equal(uploadPathFromPart({ type: "text", text: uploadPath }), null);
});

test("ignores a file part with no upload path", () => {
  assert.equal(uploadPathFromPart({ type: "file", url: "https://example.com/a.png" }), null);
  assert.equal(uploadPathFromPart({ type: "file" }), null);
});

test("ignores binary data that is not an upload path", () => {
  assert.equal(uploadPathFromPart({ type: "file", data: new Uint8Array([1, 2, 3]) }), null);
});

test("known-upload lookup uses the url field", () => {
  const known = new Set([uploadPath]);
  assert.equal(partReferencesKnownUpload({ type: "file", url: uploadPath }, known), true);
  assert.equal(partReferencesKnownUpload({ type: "file", url: "/api/uploads/other" }, known), false);
});

test("rejects malformed input without throwing", () => {
  assert.equal(uploadPathFromPart(null), null);
  assert.equal(uploadPathFromPart("string"), null);
  assert.equal(uploadPathFromPart(undefined), null);
});
