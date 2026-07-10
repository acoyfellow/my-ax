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
// Voice mode (#1 C1): hands-free & server-driven. The client input is disabled
// and NO client-side transcript is shown while voice is active.
assertIncludes(chat, '{#if voiceEnabled}', "voice mode renders a distinct hands-free state");
assertIncludes(chat, 'class="voice-mode-active"', "voice mode shows an audio-active affordance, not a transcript");
assertIncludes(chat, '{#if !voiceEnabled}\n              <textarea', "the text input is removed/disabled while voice is active");
assertNotIncludes(chat, 'class="voice-mode-interim"', "the old client-side interim transcript strip must be gone");
// Long-thread history bug: render the durable D1 transcript eagerly on
// switch/resume so messages appear immediately instead of waiting for the slow
// WS replay (the 'put the phone down and come back' bug).
assertIncludes(chat, 'function eagerRestoreFromD1(', "eager D1 transcript fast-path exists");
assertIncludes(chat, 'eagerRestoreFromD1(sessionGeneration.capture());\n  }', "switchToSession eagerly loads durable history");
assertIncludes(chat, 'if (resumingExistingSession) eagerRestoreFromD1(sessionGeneration.capture());', "bootstrap resume (notification deep-link) eagerly loads durable history");
assertIncludes(chat, 'restoreD1History(expected, true)', "the eager fast-path load is quiet (no recovery toast on a normal resume)");
// #10 webcam vision: camera capture routes through the shared upload path so a
// frame becomes a normal (removable) attachment the agent can see.
assertIncludes(chat, 'data-camera-button="1"', "composer exposes a webcam capture control");
assertIncludes(chat, 'onclick={cameraOn ? captureFrame : toggleCamera}', "camera button toggles on, then captures a frame");
assertIncludes(chat, 'await addImageFile(new File([blob], frameFilename()', "a captured frame is attached via the shared upload path");
assertIncludes(chat, 'getUserMedia({ video: { facingMode: "user" }, audio: false })', "camera opens video-only in an explicit gesture (privacy)");
assertIncludes(chat, 'data-camera-preview="1"', "a live preview shows what will be captured before sending");
// #1 C2: turn-boundary chime wired on the voice statuschange edge.
assertIncludes(chat, 'maybeChime(status)', "voice statuschange drives the turn-boundary chime");
assertIncludes(chat, 'chimeForTransition(prevChimeStatus, next)', "chime fires only on a status edge");
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
// Composer safe-area padding is iOS/standalone/touch-only, never desktop.
assertIncludes(appCss, '@media (display-mode: standalone), (pointer: coarse) {', "composer safe-area buffer must be gated to standalone/touch contexts");
assertIncludes(appCss, 'padding-bottom: calc(env(safe-area-inset-bottom) + 45px);', "iOS home-indicator clearance must be preserved inside the gate");
{
  // The safe-area buffer must live INSIDE the responsive gate, not as an
  // unconditional rule that over-pads desktop.
  const gateIndex = appCss.indexOf('@media (display-mode: standalone), (pointer: coarse) {');
  const bufferIndex = appCss.indexOf('padding-bottom: calc(env(safe-area-inset-bottom) + 45px);');
  if (!(gateIndex >= 0 && bufferIndex > gateIndex)) {
    throw new Error("composer safe-area padding must be nested within the standalone/coarse media gate");
  }
}

console.log("✓ chat composer smoke: action button is Send or Stop; connector reauth waits for owner CTA");
