import assert from "node:assert/strict";
import { test } from "node:test";
import { TranscriptCache } from "./transcript-cache";

test("a viewed chat comes back from memory", () => {
  const cache = new TranscriptCache<string>(2);
  cache.write("a", ["hi"]);
  assert.deepEqual(cache.read("a"), ["hi"]);
});

test("an unseen or empty chat has nothing cached", () => {
  const cache = new TranscriptCache<string>(2);
  cache.write("empty", []);
  assert.equal(cache.read("missing"), null);
  assert.equal(cache.read("empty"), null);
});

test("the least recently viewed chat is evicted first", () => {
  const cache = new TranscriptCache<string>(2);
  cache.write("a", ["a"]);
  cache.write("b", ["b"]);
  cache.read("a");
  cache.write("c", ["c"]);
  assert.equal(cache.read("b"), null);
  assert.deepEqual(cache.read("a"), ["a"]);
  assert.deepEqual(cache.read("c"), ["c"]);
});
