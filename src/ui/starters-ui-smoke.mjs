#!/usr/bin/env node
// Locks the editable-conversation-starters wiring across the stack (pure store
// logic is unit-tested in src/conversation-starters.test.ts):
//  - Chat loads owner starters and falls back to defaults;
//  - Settings has a CRUD "Starters" section that PUTs and notifies chat;
//  - the route + agent tool go through the same store.
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const settings = readFileSync(new URL("./Settings.svelte", import.meta.url), "utf8");
const route = readFileSync(new URL("../../src/routes/starters.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../../src/tools.ts", import.meta.url), "utf8");

function has(hay, needle, label) { if (!hay.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`); }

// Chat consumes owner starters (with a seeded default fallback).
has(chat, "async function loadStarters()", "chat loads owner starters");
has(chat, 'fetch("/api/starters"', "chat fetches the starters endpoint");
has(chat, "void loadStarters();", "chat loads starters on mount");
has(chat, 'my-ax:starters-refresh', "chat refreshes starters when edited");
has(chat, "let prompts = $state", "starters are reactive (not a const)");

// Settings CRUD section.
has(settings, '{ id: "starters" as const', "Settings has a Starters nav section");
has(settings, "async function saveStarters()", "Settings can save starters");
has(settings, 'fetch("/api/starters", { method: "PUT"', "Settings PUTs the starters");
has(settings, "function addStarter()", "Settings can add a starter");
has(settings, "function removeStarter(", "Settings can remove a starter");
has(settings, "function moveStarter(", "Settings can reorder starters");
has(settings, 'new Event("my-ax:starters-refresh")', "Settings notifies chat after save");

// Route + agent tool share the store.
has(route, '"/api/starters"', "GET/PUT starters route exists");
has(route, "getConversationStarters", "route reads via the shared store");
has(route, "setConversationStarters", "route writes via the shared store");
has(tools, 'name: "manage_starters"', "agent can manage starters (no-UI path)");
has(tools, "setConversationStarters(ctx.env, email, args.starters)", "agent tool writes the same store");

console.log("\u2713 starters UI smoke: chat consumes owner starters; Settings CRUD + agent tool share one server store");
