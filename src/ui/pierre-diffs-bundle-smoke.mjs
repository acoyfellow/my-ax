import assert from "node:assert/strict";
import { Hono } from "hono";
import { attachSvelteRoutes } from "svelte-hono";
import { bundles } from "./bundles.generated.ts";

const pierreBundle = bundles["pierre-diffs"];
const chatBundle = bundles.chat;

assert.ok(pierreBundle, "Pierre bundle must be registered");
assert.match(pierreBundle.hash ?? "", /^[a-f0-9]{8}$/);
assert.ok(pierreBundle.js.length > 0, "Pierre bundle must contain JavaScript");
assert.equal(pierreBundle.css, "");
assert.ok(chatBundle, "Chat bundle must be registered");
assert.match(chatBundle.js, /@my-ax\/pierre-diffs/);
assert.doesNotMatch(chatBundle.js, /@pierre\/diffs/);
assert.ok(chatBundle.js.length < 1_000_000, "Chat bundle must not contain Pierre's implementation");

const app = new Hono();
attachSvelteRoutes(app, { bundles });

const response = await app.request(`http://localhost/__svelte/pierre-diffs.${pierreBundle.hash}.js`);
assert.equal(response.status, 200);
assert.match(response.headers.get("content-type") ?? "", /^application\/javascript/);

const bytes = new Uint8Array(await response.arrayBuffer());
assert.ok(bytes.byteLength > 0, "Pierre URL must serve nonempty bytes");
const source = new TextDecoder().decode(bytes);
assert.equal(source, pierreBundle.js);

const pierreModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
assert.equal(typeof pierreModule.FileDiff, "function");

console.log("✓ Pierre lazy bundle serves executable bytes without inflating Chat");
