#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { outboundMessageText } from "./outbound-message.ts";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const betaPage = readFileSync(new URL("../../src/views/BetaPage.tsx", import.meta.url), "utf8");
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

if (outboundMessageText("hello") !== "hello") {
  throw new Error("outbound messages must retain their first visible character");
}
if (outboundMessageText("  code") !== "  code") {
  throw new Error("outbound preformatted whitespace must remain intact");
}

assertIncludes(chat, 'if (composerLocked && wsState.status !== "done") return wsState.status;', "composer collapses completed turns back to Send");
assertIncludes(chat, 'return "idle";', "composer falls back to Send after completed turns");
assertIncludes(chat, 'aria-label={wsState.conn === "offline" ? "Offline — tap to retry" : sendStatus === "thinking" || sendStatus === "running" ? "Stop the agent" : "Send message"}', "composer accessible action remains Send/Stop and offers Retry when terminally offline");
assertIncludes(chat, '{#if voiceEnabled}', "voice mode renders a distinct hands-free state");
assertIncludes(chat, 'class="voice-mode-active"', "voice mode shows an audio-active affordance, not a transcript");
assertIncludes(chat, '{#if !voiceEnabled}\n              <textarea', "the text input is removed/disabled while voice is active");
assertNotIncludes(chat, 'class="voice-mode-interim"', "the old client-side interim transcript strip must be gone");
assertIncludes(chat, 'function eagerRestoreFromD1(', "eager D1 transcript fast-path exists");
assertIncludes(chat, 'eagerRestoreFromD1(sessionGeneration.capture());\n  }', "switchToSession eagerly loads durable history");
assertIncludes(chat, 'if (resumingExistingSession) eagerRestoreFromD1(sessionGeneration.capture());', "bootstrap resume eagerly loads durable history");
assertIncludes(chat, 'restoreD1History(expected, true)', "the eager fast-path load is quiet");
assertIncludes(chat, 'data-plus-button="1"', "composer exposes a single + menu button");
assertIncludes(chat, 'onclick={plusAddFile}', "the + menu has an Add file item");
assertIncludes(chat, 'onclick={plusCamera}', "the + menu has a Camera item");
assertIncludes(chat, 'data-camera-button="1"', "an active camera exposes a capture-frame control");
assertIncludes(chat, 'onclick={captureFrame}', "the active-camera button captures a frame");
assertIncludes(chat, 'await addImageFile(new File([blob], frameFilename()', "a captured frame is attached via the shared upload path");
assertIncludes(chat, 'getUserMedia({ video: { facingMode: "user" }, audio: false })', "camera opens video-only in an explicit gesture");
assertIncludes(chat, 'data-camera-preview="1"', "a live preview shows what will be captured before sending");
assertIncludes(chat, 'maybeChime(status)', "voice statuschange drives the turn-boundary chime");
assertIncludes(chat, 'chimeForTransition(prevChimeStatus, next)', "chime fires only on a status edge");
assertNotIncludes(chat, 'data-[status=done]', "composer must not carry dedicated done/checkmark styling");
assertNotIncludes(chat, '{:else if sendStatus === "done"}', "composer must not render a done/checkmark branch");

for (const marker of ['CONNECTOR_REAUTH_REQUIRED', 'my_ax_connector_reauth']) {
  const index = chat.indexOf(marker);
  if (index === -1) throw new Error(`connector reauth path missing ${marker}`);
  const windowText = chat.slice(index, index + 450);
  assertNotIncludes(windowText, 'settings-open', `connector reauth ${marker} must not auto-open Settings`);
}
assertIncludes(chat, 'class="connector-banner__cta"', "connector reauth banner keeps an explicit owner CTA");
assertIncludes(chat, 'Authorization failed for ${connector}. Tap "Authorize" to try again.', "OAuth callback toast does not reflect raw provider reason text");
assertNotIncludes(chat, 'Authorization failed for ${connector}${reason', "OAuth callback toast must not include raw reason query text");
assertIncludes(chat, 'my-ax:artifact-submit', "chat listens for artifact form submissions");
assertIncludes(chat, 'artifactWindows()', "artifact submits are accepted only from live artifact iframes");
assertIncludes(chat, 'window.addEventListener("message", onArtifactMessage)', "the artifact message bridge is wired");
assertIncludes(chat, "TURN_STALL_MS", "a turn-stall threshold exists");
assertIncludes(chat, "gone quiet without finishing", "stalled turn surfaces a truthful notice");
assertIncludes(chat, "lastTurnFrameAt", "the watchdog tracks the last turn frame time");
assertIncludes(appCss, '.connector-banner[data-state="upstream-auth"]', "connector upstream-auth banner state is visibly styled");
assertNotIncludes(appCss, '#send', "global CSS must not define stale #send composer selectors");
assertNotIncludes(appCss, '#theme-cycle', "global CSS must not define stale #theme-cycle selectors");
assertIncludes(appCss, 'position: fixed;', "app-viewport frame must be position:fixed");
assertIncludes(appCss, '#svelte-hono-chat-root {', "chat mount must be made a filling flex child");
assertIncludes(appCss, '#svelte-hono-beta-root {', "beta mount must have a definite-height rule");
assertIncludes(betaPage, 'hydrateAs="beta"', "BetaPage mounts the single-root app embed");
assertIncludes(appCss, 'padding-bottom: max(0.625rem, env(safe-area-inset-bottom));', "composer padding must be device-adaptive");

console.log("✓ chat composer smoke: outbound text preserves its leading content");
