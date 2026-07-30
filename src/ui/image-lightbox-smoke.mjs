#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lightbox = readFileSync(new URL("./ImageLightbox.svelte", import.meta.url), "utf8");
const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const widget = readFileSync(new URL("./ToolResultWidget.svelte", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/app.css", import.meta.url), "utf8");

assert.match(chat, /import ImageLightbox from "\.\/ImageLightbox\.svelte"/);
assert.match(chat, /<ImageLightbox\s*\/>/);
assert.match(lightbox, /\.msg-body img/);
assert.match(lightbox, /\.tool-call__inline-image/);
assert.match(lightbox, /MutationObserver/);
assert.match(lightbox, /showModal\(\)/);
assert.match(lightbox, /event\.key !== "Enter" && event\.key !== " "/);
assert.match(lightbox, /Open original/);
assert.match(widget, /tool-call__inline-image/g);
assert.match(css, /\.tool-call__inline-image[\s\S]{0,300}width: min\(14rem/);
assert.match(css, /\.msg-body img\[data-image-lightbox="1"\]/);

console.log("✓ shared image thumbnails open in one keyboard-accessible lightbox");
