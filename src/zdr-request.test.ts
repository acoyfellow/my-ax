import assert from "node:assert/strict";
import { test } from "node:test";
import { dropUnresolvableReasoning } from "./zdr-request";

test("with store:false, earlier reasoning items are never sent back, so the server is never asked to look one up", () => {
  const body = JSON.stringify({ store: false, input: [
    { role: "user", content: "hi" },
    { type: "reasoning", id: "rs_missing", summary: [] },
    { type: "reasoning", id: "rs_ok", encrypted_content: "enc", summary: [] },
    { type: "item_reference", id: "rs_ref" },
    { type: "function_call", call_id: "c1", name: "work_code", arguments: "{}" },
  ] });
  const sent = JSON.parse(dropUnresolvableReasoning(body));
  assert.deepEqual(sent.input.map((item: { id?: string; type?: string; role?: string }) => item.id ?? item.type ?? item.role), ["user", "function_call"]);
});

test("stored conversations are left alone", () => {
  const body = JSON.stringify({ store: true, input: [{ type: "item_reference", id: "rs_ref" }] });
  assert.equal(dropUnresolvableReasoning(body), body);
});
