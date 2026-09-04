import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const desk = readFileSync(new URL("./Desk.svelte", import.meta.url), "utf8");
const shell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

test("the desk is mounted by the app shell, not inside chat", () => {
  assert.match(shell, /<Desk\s*\/>/);
  assert.doesNotMatch(chat, /<Desk\s*\/>/);
});

test("the desk owns its own outbound bridge so it survives leaving chat", () => {
  assert.match(desk, /new ArtifactOutboundBridge\(/);
  assert.match(desk, /"my-ax:host-invoke"/);
});

test("the desk hosts an agent-authored app in a sandboxed frame", () => {
  assert.match(desk, /\/api\/artifacts\/\$\{encodeURIComponent\(hostedArtifactId\)\}\/preview/);
  assert.match(desk, /sandbox="allow-scripts"/);
});

test("the desk frame never gets same-origin access to the owner session", () => {
  const frame = desk.slice(desk.indexOf("desk-app-frame"), desk.indexOf("></iframe>"));
  assert.doesNotMatch(frame, /allow-same-origin/);
  assert.match(desk, /referrerpolicy="no-referrer"/);
});

test("the desk reads its app state from the app endpoint", () => {
  assert.match(desk, /fetch\("\/api\/desk\/app"/);
});

test("the empty state tells the owner how a desk gets built", () => {
  assert.match(desk, /deskWrite/);
  assert.doesNotMatch(desk, /desk_upsert instead of a new conversation/);
});

test("every legacy desk card has an owner-controlled removal action", () => {
  const removeCard = desk.slice(desk.indexOf("async function removeCard"), desk.indexOf("function closePanel"));
  assert.match(removeCard, /encodeURIComponent\(cardId\)/);
  assert.match(removeCard, /method: "DELETE"/);
  assert.match(desk, /\{#each board\.cards as card \(card\.id\)\}/);
  assert.match(desk, /class="desk-remove"/);
  assert.match(desk, /removeCard\(card\.id\)/);
});
