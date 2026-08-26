import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DESK_APP_FRAME, deskAppFrame, parseDeskAppFrame } from "./desk-live";
import { emptyDeskApp } from "./desk-app";

test("a desk app frame round-trips over the wire", () => {
  const app = { ...emptyDeskApp(), artifactId: "art-1", state: { note: "live" }, updatedBy: "oracle" };
  const parsed = parseDeskAppFrame(JSON.parse(deskAppFrame(app)));
  assert.equal(parsed?.artifactId, "art-1");
  assert.deepEqual(parsed?.state, { note: "live" });
});

test("a board frame is not mistaken for an app frame", () => {
  assert.equal(parseDeskAppFrame({ type: "desk.board", board: { cards: [] } }), null);
  assert.equal(parseDeskAppFrame({ type: DESK_APP_FRAME }), null);
});

test("writing the desk app broadcasts; a write nobody sees is not live", () => {
  const routes = readFileSync(new URL("./routes/desk.ts", import.meta.url), "utf8");
  const write = routes.slice(routes.indexOf("export async function ownerDeskAppWrite"));
  const body = write.slice(0, write.indexOf("\n}"));
  assert.match(body, /broadcastDeskApp/, "the app write path must broadcast");
});

test("the owner root can fan an app frame to every client", () => {
  const agent = readFileSync(new URL("./user-agent.ts", import.meta.url), "utf8");
  assert.match(agent, /async broadcastDeskApp\(/);
  assert.match(agent, /this\.broadcast\(frame\)/, "the owner root itself must broadcast, not only session facets");
});

test("the client routes a desk.app frame to the desk, not only to chat", () => {
  const chat = readFileSync(new URL("./ui/Chat.svelte", import.meta.url), "utf8");
  assert.match(chat, /m\.type === "desk\.app"/);
  assert.match(chat, /my-ax:desk-app/);
  const desk = readFileSync(new URL("./ui/Desk.svelte", import.meta.url), "utf8");
  assert.match(desk, /addEventListener\("my-ax:desk-app"/, "the desk must listen for the live frame itself");
});

test("the desk pushes new state into the hosted app without a reload", () => {
  const desk = readFileSync(new URL("./ui/Desk.svelte", import.meta.url), "utf8");
  const handler = desk.slice(desk.indexOf("const onAppState"), desk.indexOf("const onMessage"));
  assert.match(handler, /pushStateToApp\(\)/, "a live frame must reach the iframe");
});

test("an action inside the desk app reaches every client", () => {
  const desk = readFileSync(new URL("./ui/Desk.svelte", import.meta.url), "utf8");
  assert.match(desk, /my-ax:host-invoke/, "the desk hosts the outbound bridge");
  const registry = readFileSync(new URL("./ui/page-registry.ts", import.meta.url), "utf8");
  const deskWrite = registry.slice(registry.indexOf('name: "deskWrite"'));
  assert.match(deskWrite.slice(0, 900), /\/api\/desk\/app/, "deskWrite must hit the broadcasting endpoint");
});
