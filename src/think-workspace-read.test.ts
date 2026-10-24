import assert from "node:assert/strict";
import test from "node:test";
import { fileStreamBytes } from "./think-workspace";

function sandboxFileStream(text: string): ReadableStream<Uint8Array> {
  const events = [
    { type: "metadata", mimeType: "text/plain", size: text.length, isBinary: false, encoding: "utf-8" },
    { type: "chunk", data: text },
    { type: "complete", bytesRead: text.length },
  ];
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body).body as ReadableStream<Uint8Array>;
}

test("Think's read tool gets the file's bytes, not the Sandbox's SSE framing", async () => {
  const bytes = await fileStreamBytes(sandboxFileStream("think-ok"));
  assert.equal(new TextDecoder().decode(bytes), "think-ok");
});
