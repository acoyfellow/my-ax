import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { emptyListView } from "./session-list-empty";

test("an empty archived view offers a way back", () => {
  const view = emptyListView(true);
  assert.equal(view.text, "No archived conversations.");
  assert.equal(view.showArchiveToggle, true);
  assert.equal(view.toggleLabel, "Back to conversations");
});

test("an empty normal view still offers archived conversations", () => {
  const view = emptyListView(false);
  assert.equal(view.showArchiveToggle, true);
  assert.equal(view.toggleLabel, "Show archived");
});

test("the empty branch of the conversation list renders the archive toggle", () => {
  const source = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");
  const emptyBranch = source.slice(source.indexOf("{:else if sessions.length === 0}"), source.indexOf("{:else}", source.indexOf("{:else if sessions.length === 0}")));
  assert.match(emptyBranch, /toggleArchivedView/);
  assert.match(emptyBranch, /emptyListView\(showArchived\)/);
});
