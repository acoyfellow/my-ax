#!/usr/bin/env node
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const chatPage = readFileSync(new URL("../../src/views/ChatPage.tsx", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../../src/styles/app.css", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
  }
}

function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) {
    throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
  }
}

assertIncludes(chat, 'if (composerLocked && wsState.status !== "done") return wsState.status;', "composer collapses completed turns back to Send");
assertIncludes(chat, 'return "idle";', "composer falls back to Send after completed turns");
assertIncludes(chat, 'aria-label={wsState.conn === "offline" ? "Offline — tap to retry" : sendStatus === "thinking" || sendStatus === "running" ? "Stop the agent" : "Send message"}', "composer accessible action remains Send/Stop and offers Retry when terminally offline");
assertNotIncludes(chat, 'data-[status=done]', "composer must not carry dedicated done/checkmark styling");
assertNotIncludes(chat, '{:else if sendStatus === "done"}', "composer must not render a done/checkmark branch");
assertNotIncludes(chat, 'stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\n                <polyline points="20 6 9 17 4 12" />', "composer must not render a checkmark as its action glyph");

for (const marker of ['CONNECTOR_REAUTH_REQUIRED', 'my_ax_connector_reauth']) {
  const index = chat.indexOf(marker);
  if (index === -1) throw new Error(`connector reauth path missing ${marker}`);
  const windowText = chat.slice(index, index + 450);
  assertNotIncludes(windowText, 'settings-open', `connector reauth ${marker} must not auto-open Settings`);
}
assertIncludes(chat, 'class="connector-banner__cta"', "connector reauth banner keeps an explicit owner CTA");
assertIncludes(chat, 'Authorization failed for ${connector}. Tap "Authorize" to try again.', "OAuth callback toast does not reflect raw provider reason text");
assertNotIncludes(chat, 'Authorization failed for ${connector}${reason', "OAuth callback toast must not include raw reason query text");
assertIncludes(chatPage, '.connector-banner[data-state="upstream-auth"]', "connector upstream-auth banner state is visibly styled");
assertNotIncludes(appCss, '#send', "global CSS must not define stale #send composer selectors");
assertNotIncludes(appCss, '#theme-cycle', "global CSS must not define stale #theme-cycle selectors");

console.log("✓ chat composer smoke: action button is Send or Stop; connector reauth waits for owner CTA");
