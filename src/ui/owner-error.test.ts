import assert from "node:assert/strict";
import test from "node:test";
import { clarifyOwnerError } from "./owner-error";

test("Invalid URL string becomes one owner sentence", () => {
  assert.equal(
    clarifyOwnerError("Invalid URL string."),
    "A link on this turn is not a valid URL. The turn stopped. Check desk or notify hrefs.",
  );
});

test("other errors stay as written", () => {
  assert.equal(clarifyOwnerError("Image upload failed"), "Image upload failed");
});
