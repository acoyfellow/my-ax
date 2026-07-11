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
// Robust app frame (device-agnostic; no per-device padding hacks).
// 1) The shell is a fixed, full-viewport box that can't be scroll-offset.
assertIncludes(appCss, 'position: fixed;', "app-viewport frame must be position:fixed so it cannot be scroll-offset");
assertIncludes(appCss, 'height: 100dvh;', "app-viewport height tracks the dynamic viewport (URL bar + keyboard)");
{
  const av = appCss.indexOf('.app-viewport {');
  const block = appCss.slice(av, av + 220);
  if (!/position:\s*fixed/.test(block) || !/inset:\s*0/.test(block) || !/height:\s*100dvh/.test(block)) {
    throw new Error("the .app-viewport frame must be position:fixed; inset:0; height:100dvh");
  }
}
// 2) The chat mount fills its slot so the composer footer sits at the bottom.
assertIncludes(appCss, '#svelte-hono-chat-root {', "chat mount must be made a filling flex child (unbroken h-full chain)");
{
  // The mount rule is load-bearing for the footer position: require the actual
  // fill declarations, not just the selector, so silently dropping them fails.
  const i = appCss.indexOf('#svelte-hono-chat-root {');
  const block = appCss.slice(i, i + 160);
  for (const decl of ['flex: 1 1 0%;', 'min-height: 0;', 'display: flex;', 'flex-direction: column;']) {
    if (!block.includes(decl)) throw new Error(`chat mount fill rule must include ${JSON.stringify(decl)}`);
  }
}
// The chat embed must forward wrapperClass="contents" so the generic mount
// wrapper does not re-break the height chain the CSS rule depends on.
assertIncludes(chatPage, 'hydrateAs="chat"', "ChatPage mounts the chat embed");
{
  const i = chatPage.indexOf('hydrateAs="chat"');
  const around = chatPage.slice(Math.max(0, i - 120), i + 160);
  if (!around.includes('wrapperClass="contents"')) throw new Error("chat embed must forward wrapperClass=\"contents\"");
}
// ...and SvelteEmbed must actually apply that class to the mount wrapper.
// Forwarding the prop is useless if the wrapper hardcodes/drops the class,
// which would silently re-break the height chain while this smoke stays green.
{
  const svelteEmbed = readFileSync(new URL("./SvelteEmbed.tsx", import.meta.url), "utf8");
  if (!/<div class=\{wrapperClass\} dangerouslySetInnerHTML=/.test(svelteEmbed)) {
    throw new Error("SvelteEmbed must apply wrapperClass to its mount wrapper");
  }
}
// 3) Composer padding is a single device-adaptive rule: max(base, real inset).
//    0 on desktop / macOS PWA (no curvature), the true inset on notched iOS.
assertIncludes(appCss, 'padding-bottom: max(0.625rem, env(safe-area-inset-bottom));', "composer padding must be a single max(base, env-inset) rule");
assertNotIncludes(appCss, 'env(safe-area-inset-bottom) + 45px', "the hardcoded +45px composer hack must be gone");
assertNotIncludes(appCss, '@media (display-mode: standalone), (pointer: coarse) {', "composer padding must not be gated on display-mode/pointer heuristics");
// 4) Landscape notch/rounded-corner clearance: both the app bar and composer
//    must reserve the horizontal safe-area insets (0 on non-notched devices).
for (const [sel, span] of [['.safe-area-appbar {', 480], ['.safe-area-composer {', 480]]) {
  const i = appCss.indexOf(sel);
  if (i < 0) throw new Error(`missing ${sel}`);
  const block = appCss.slice(i, i + span);
  if (!/padding-left:\s*max\([^;]*env\(safe-area-inset-left\)/.test(block) ||
      !/padding-right:\s*max\([^;]*env\(safe-area-inset-right\)/.test(block)) {
    throw new Error(`${sel} must reserve env(safe-area-inset-left/right) for landscape notch clearance`);
  }
}

console.log("✓ chat composer smoke: fixed frame, filling chat mount, device-adaptive composer padding");
