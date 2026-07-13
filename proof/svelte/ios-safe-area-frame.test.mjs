#!/usr/bin/env node
// Deterministic regression for the iOS "white bar below the composer" bug.
//
// WHAT THIS PROVES
// ----------------
// The bug's root cause is a pure CSS spec behavior we can reproduce
// deterministically in any engine: a `position:fixed; inset:0` box that ALSO
// sets an explicit block-axis height is over-constrained (CSS 2.1 §10.6.4), so
// the UA ignores `bottom` and lays the box out at top:0 with that height. When
// the height (modeling iOS `100dvh`, which excludes the home-indicator inset
// under viewport-fit=cover) is shorter than the positioning containing block
// (modeling the full cover screen), a gap opens below the frame and the page
// background shows through — the owner's white bar.
//
// This harness renders BOTH the broken shape and the SHIPPED app.css shape into
// a "device" box sized to representative iPhone CSS viewports (incl. the exact
// 1320x2868 / DPR3 screenshot = 440x956 CSS), with the app's real flex chain
// (h-full wrapper → grow → composer padded by the home-indicator inset), and
// asserts, via live getBoundingClientRect:
//   • the app frame bottom == device bottom (no background band below it)
//   • the composer bottom == device bottom (controls sit on the safe edge)
//   • keyboard-open: composer stays fully inside the visible box (no overlap)
// It also asserts the broken shape DOES leak a gap, so the test proves it can
// still catch a regression.
//
// WHAT THIS DOES NOT PROVE
// ------------------------
// Desktop Playwright (Chromium/WebKit) does NOT faithfully emulate an installed
// iOS PWA's env(safe-area-inset-*) / 100dvh / home-indicator behavior, and it
// compares live layout rather than the owner's stored screenshot. So this is
// supplementary deterministic proof of the CSS MECHANISM and of the app.css
// frame shape — NOT proof of the real device rendering. Final sign-off remains
// owner retest on the physical iPhone after deploy.
//
// NO DEP CHURN: reuses whatever Playwright is already resolvable; if none is
// installed, the test SKIPS (exit 0) with a clear notice rather than failing CI
// (CI's `npm ci` does not install Playwright browsers).
import { readFileSync } from "node:fs";

let chromium = null;
try { ({ chromium } = await import("playwright")); } catch {}
if (!chromium) {
  console.log("skip: playwright not resolvable in this environment (no dep added); browser proof skipped");
  process.exit(0);
}

const appCss = readFileSync(new URL("../../src/styles/app.css", import.meta.url), "utf8");

// Pull the SHIPPED .app-viewport declarations straight from app.css so this
// test tracks the real stylesheet, not a hand-copied snippet.
//
// The real frame is `position: fixed`, whose containing block is the layout
// viewport (= the full cover screen on iOS). To model that deterministically we
// render the frame inside a `position: relative` "device" box the size of the
// cover screen and remap fixed→absolute, so the device box becomes the frame's
// containing block. fixed and absolute share identical block-axis sizing math
// (CSS 2.1 §10.6.4) — only the containing block differs — so this faithfully
// reproduces the over-constraint behavior we care about.
function appViewportBlock() {
  const i = appCss.indexOf(".app-viewport {");
  if (i < 0) throw new Error("`.app-viewport {` not found in app.css");
  const body = appCss.slice(i + ".app-viewport {".length, appCss.indexOf("}", i));
  // Keep only the layout-affecting declarations, and remap fixed→absolute so
  // the device box is the containing block (see note above).
  return body
    .split(";")
    .map((d) => d.trim())
    .filter((d) => /^(position|inset|top|right|bottom|left|height|margin|overflow)\b/.test(d))
    .map((d) => d.replace(/^position\s*:\s*fixed$/, "position: absolute"))
    .join("; ");
}

const SAB = 34; // iPhone home-indicator inset (CSS px), reported by iOS as env(safe-area-inset-bottom)
const TOOLBAR = 88; // iOS Safari bottom toolbar height (CSS px). In an installed
// (standalone) PWA there is NO toolbar, but iOS still sizes a fixed inset:0 box
// to the small (toolbar-present) viewport, leaving a toolbar-height white bar.

// Assert app.css ships the standalone override that fixes the installed-PWA
// bar, and model it below with height = full device screen (what 100lvh /
// -webkit-fill-available resolve to in a chromeless standalone PWA).
if (!/@media \(display-mode: standalone\) \{[\s\S]*?\.app-viewport \{[\s\S]*?height:\s*100lvh/.test(appCss)) {
  throw new Error("REGRESSION: app.css missing the standalone .app-viewport height:100lvh override (reopens the installed-PWA white bar)");
}

// Representative CSS viewports (portrait). The first is the owner's exact
// screenshot geometry (1320x2868 physical ÷ DPR 3).
const VIEWPORTS = [
  { name: "iPhone-16-Pro-Max-1320x2868", w: 440, h: 956, dpr: 3 },
  { name: "iPhone-15-Pro-393x852", w: 393, h: 852, dpr: 3 },
  { name: "iPhone-SE-375x667", w: 375, h: 667, dpr: 2 },
  { name: "iPhone-15-Pro-Max-430x932", w: 430, h: 932, dpr: 3 },
];

// The "device" is a relative box the size of the full cover screen; the frame is
// position:absolute so its containing block is the device (faithfully mirrors
// position:fixed under viewport-fit=cover, whose ICB is the full screen). The
// broken frame models iOS 100dvh by using height = screen - SAB.
function html(frameDecls, deviceH, keyboardOpen) {
  // When the keyboard is open the app drops the composer's safe-area buffer
  // (`.keyboard-open .safe-area-composer { padding-bottom: 0.625rem }`) and the
  // visible area shrinks by the keyboard height. Model that by shrinking the
  // device box and removing the composer's inset padding.
  const kb = keyboardOpen ? 336 : 0;
  const composerPadBottom = keyboardOpen ? "10px" : `max(10px, ${SAB}px)`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin:0; box-sizing:border-box; }
    html, body { height:100%; background:#ffffff; } /* light-mode html bg = the white bar */
    .device { position:relative; width:100%; height:${deviceH - kb}px; overflow:hidden; }
    .app-viewport { ${frameDecls}; background:#0a0a0a; overflow:hidden; display:flex; flex-direction:column; }
    .hfull { height:100%; display:flex; flex-direction:column; }
    .grow { flex:1 1 0%; min-height:0; background:#0a0a0a; }
    .composer { flex:none; background:#e5e5e5; padding-bottom:${composerPadBottom}; min-height:56px; }
    .controls { height:44px; background:#cccccc; }
  </style></head><body>
    <div class="device" id="device">
      <div class="app-viewport" id="frame">
        <div class="hfull">
          <div class="grow"></div>
          <div class="composer" id="composer"><div class="controls" id="controls"></div></div>
        </div>
      </div>
    </div>
  </body></html>`;
}

async function rects(page, frameDecls, deviceH, keyboardOpen) {
  await page.setContent(html(frameDecls, deviceH, keyboardOpen));
  return page.evaluate(() => {
    const g = (id) => document.getElementById(id).getBoundingClientRect();
    const d = g("device"), f = g("frame"), c = g("composer"), ctl = g("controls");
    return {
      deviceBottom: Math.round(d.bottom),
      frameBottom: Math.round(f.bottom),
      composerBottom: Math.round(c.bottom),
      controlsBottom: Math.round(ctl.bottom),
    };
  });
}

// Shipped decls (fixed→absolute remapped). Must carry NO explicit height.
const shippedDecls = appViewportBlock();
if (/height\s*:/.test(shippedDecls)) {
  throw new Error(`REGRESSION: .app-viewport must not set an explicit height; got: ${shippedDecls}`);
}
// Broken shape = shipped decls but re-add an explicit height modeling iOS
// 100dvh (screen minus the home-indicator inset). Literal px, computed per
// viewport below — NOT a CSS var, because page.setContent() replaces the whole
// document and would drop any :root var injected separately.
function brokenDeclsFor(dvhPx) { return `${shippedDecls}; height: ${dvhPx}px`; }

const failures = [];
function check(cond, msg) { if (!cond) failures.push(msg); }

for (const engineName of ["chromium"]) {
  const browser = await chromium.launch();
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
    const page = await ctx.newPage();
    const dvh = vp.h - SAB; // model iOS 100dvh (excludes home-indicator region)

    // 1) SHIPPED shape, keyboard closed: frame + composer reach the bottom.
    const shipped = await rects(page, shippedDecls, vp.h, false);
    check(shipped.frameBottom === shipped.deviceBottom,
      `[${engineName} ${vp.name}] shipped frame bottom ${shipped.frameBottom} != device bottom ${shipped.deviceBottom} (background band leak)`);
    check(shipped.composerBottom === shipped.deviceBottom,
      `[${engineName} ${vp.name}] shipped composer bottom ${shipped.composerBottom} != device bottom ${shipped.deviceBottom}`);

    // 2) SHIPPED shape, keyboard open: composer fully visible, no overlap.
    const shippedKb = await rects(page, shippedDecls, vp.h, true);
    check(shippedKb.composerBottom === shippedKb.deviceBottom,
      `[${engineName} ${vp.name}] keyboard-open composer bottom ${shippedKb.composerBottom} != visible bottom ${shippedKb.deviceBottom}`);
    check(shippedKb.controlsBottom <= shippedKb.deviceBottom,
      `[${engineName} ${vp.name}] keyboard-open controls overflow visible area (${shippedKb.controlsBottom} > ${shippedKb.deviceBottom})`);

    // 3) BROKEN shape MUST leak a gap == SAB — proves the test can catch it.
    const broken = await rects(page, brokenDeclsFor(dvh), vp.h, false);
    const gap = broken.deviceBottom - broken.frameBottom;
    check(gap === SAB,
      `[${engineName} ${vp.name}] broken shape expected a ${SAB}px white gap but got ${gap}px (guard not catching the regression)`);

    // 4) INSTALLED-PWA (standalone): the device screen is full height, but iOS
    //    sizes the fixed frame to the small (toolbar-present) viewport. Model
    //    the WITHOUT-fix case (inset:0 sized to screen-minus-toolbar) — it MUST
    //    leak a toolbar-height bar, proving the bug and that the test catches
    //    it. Then the WITH-fix case (standalone override height = full screen)
    //    MUST reach the bottom.
    const pwaBroken = await rects(page, brokenDeclsFor(vp.h - TOOLBAR), vp.h, false);
    check(pwaBroken.deviceBottom - pwaBroken.frameBottom === TOOLBAR,
      `[${engineName} ${vp.name}] standalone WITHOUT the fix should leak a ${TOOLBAR}px bar but leaked ${pwaBroken.deviceBottom - pwaBroken.frameBottom}px`);
    const pwaFixed = await rects(page, `${shippedDecls}; height: ${vp.h}px`, vp.h, false);
    check(pwaFixed.frameBottom === pwaFixed.deviceBottom,
      `[${engineName} ${vp.name}] standalone WITH the 100lvh fix: frame bottom ${pwaFixed.frameBottom} != device bottom ${pwaFixed.deviceBottom} (installed-PWA bar not closed)`);
    check(pwaFixed.composerBottom === pwaFixed.deviceBottom,
      `[${engineName} ${vp.name}] standalone WITH the fix: composer bottom ${pwaFixed.composerBottom} != device bottom ${pwaFixed.deviceBottom}`);

    await ctx.close();
  }
  await browser.close();
}

if (failures.length) {
  console.error("✗ ios-safe-area-frame regression FAILED:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`✓ ios-safe-area-frame: app frame + composer reach the viewport bottom at ${VIEWPORTS.length} iPhone viewports (keyboard closed & open); over-constrained shape still detectably leaks a ${SAB}px band`);
console.log("  note: supplementary CSS-mechanism proof only — NOT a substitute for owner retest on a physical iOS device.");
