#!/usr/bin/env node
// scripts/build-brand.mjs — generate brand assets from one source of truth.
//
// Inputs:
//   public/static/fonts/mozilla-headline.woff2   (display face)
//
// Outputs (all under public/static/brand/, plus public/favicon.ico):
//   wordmark.svg            — Master "my · ax" wordmark (used in <head> OG
//                             tags + as the inline hero in ChatPage).
//   icon-mark.svg           — Square brand mark (orange dot on dark square)
//                             for browser tab favicons that prefer SVG.
//   icon-mask.svg           — Monochrome version of icon-mark.svg for the
//                             Safari pinned-tab `<link rel="mask-icon">`.
//   favicon-16.png          ┐ Multi-resolution PNGs.
//   favicon-32.png          │
//   favicon-48.png          │
//   apple-touch-icon.png    │ 180×180 — iOS home screen.
//   icon-192.png            │ PWA manifest small.
//   icon-512.png            ┘ PWA manifest large.
//   icon-maskable-192.png   │ Full-bleed Android adaptive-icon variants.
//   icon-maskable-512.png   ┘
//   ../favicon.ico          — Multi-res ICO at /favicon.ico (root path).
//   manifest.webmanifest    — PWA manifest pointing at the PNGs above.
//   og.png                  — 1200×630 OpenGraph card with the wordmark.
//
// Why this exists:
//   - Every asset is reproducible from the master font + a small set of
//     numeric constants below (colors, dimensions). No Figma export dance.
//   - The OG image is regenerated on every deploy so the visible "v" query
//     string bust is honored.
//   - Avoids committing pre-rendered PNGs that drift out of sync with the
//     master SVG.
//
// Dependencies: sharp (already a devDep).
//
// Run:  node scripts/build-brand.mjs
// Or:   npm run build:brand  (called from build:assets)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRAND = path.join(ROOT, "public", "static", "brand");
const FONTS = path.join(ROOT, "public", "static", "fonts");

fs.mkdirSync(BRAND, { recursive: true });

// ─── Tokens ─────────────────────────────────────────────────────────────
// Keep these in sync with src/styles/app.css @theme. If we ever bump the
// brand orange or the bg color, edit it in both places.
const BG = "#0a0a0a";
const FG = "#e9e9ec";
const FG_MUT = "#8b8b91";
const BRAND_ORANGE = "#f6821f";

// Mozilla Headline as a data: URI so librsvg (which sharp uses) can rasterize
// SVGs containing text without needing the font installed on the system.
const fontData = fs.readFileSync(
  path.join(FONTS, "mozilla-headline.woff2"),
).toString("base64");
const fontFace = `
@font-face {
  font-family: "Mozilla Headline";
  font-style: normal;
  font-weight: 400;
  src: url("data:font/woff2;base64,${fontData}") format("woff2");
}
`;

// ─── Master wordmark SVG ────────────────────────────────────────────────
// Keep the supplied vector paths as the single source of truth. Emit a light
// and dark variant so the orange dot stays orange instead of relying on CSS
// inversion filters that shift brand color.
const suppliedWordmark = fs.readFileSync(path.join(ROOT, "scripts", "brand", "my-ax.svg"), "utf8");
const wordmarkSvg = suppliedWordmark.replace("<svg ", '<svg role="img" aria-label="my · ax" ');
const wordmarkDarkSvg = wordmarkSvg.replaceAll('fill="black"', `fill="${FG}"`);

fs.writeFileSync(path.join(BRAND, "wordmark.svg"), wordmarkSvg);
fs.writeFileSync(path.join(BRAND, "wordmark-dark.svg"), wordmarkDarkSvg);
console.log("✓ wordmark.svg");
console.log("✓ wordmark-dark.svg");

// ─── Icon mark (the brand mark stripped to a glyph that's legible at 16px)
// ─────────────────────────────────────────────────────────────────────
// The wordmark isn't readable below 32px. For the favicon family we drop
// to just the orange middot inside a rounded-square dark tile — the most
// distinctive piece of the brand. At 16px it reads as "the orange dot
// app", which we'll take.

const iconMarkSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="my · ax">
  <title>my · ax</title>
  <rect width="64" height="64" rx="12" ry="12" fill="${BG}"/>
  <circle cx="32" cy="32" r="10" fill="${BRAND_ORANGE}"/>
</svg>`;

fs.writeFileSync(path.join(BRAND, "icon-mark.svg"), iconMarkSvg);
console.log("✓ icon-mark.svg");

// Android adaptive / maskable PWAs need visual content inside the centered
// safe zone while still carrying opaque art to the edge of the square. Keep
// the existing rounded tile as the safe inner brand mark, but lay it over a
// full-bleed app-color background so launcher crops never produce letterbox.
const iconMaskableSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="my · ax">
  <title>my · ax</title>
  <rect width="64" height="64" fill="${BG}"/>
  <rect x="8" y="8" width="48" height="48" rx="12" ry="12" fill="${BG}"/>
  <circle cx="32" cy="32" r="10" fill="${BRAND_ORANGE}"/>
</svg>`;

// Monochrome version for Safari's pinned-tab icon. Safari rasterizes this
// itself and re-colors it with the user's pinned-tab accent + the
// `color="#f6821f"` we declare on <link rel="mask-icon">.

const iconMaskSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="10" fill="black"/>
</svg>`;

fs.writeFileSync(path.join(BRAND, "icon-mask.svg"), iconMaskSvg);
console.log("✓ icon-mask.svg");

// ─── Raster PNGs from the icon mark ─────────────────────────────────────
const ICON_SIZES = [16, 32, 48, 180, 192, 512];

for (const size of ICON_SIZES) {
  const out =
    size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  await sharp(Buffer.from(iconMarkSvg), { density: 600 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(BRAND, out));
  console.log(`✓ ${out}`);
}

for (const size of [192, 512]) {
  const out = `icon-maskable-${size}.png`;
  await sharp(Buffer.from(iconMaskableSvg), { density: 600 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(BRAND, out));
  console.log(`✓ ${out}`);
}

// Also copy the 32/192/512 with the conventional favicon names PWA tooling
// looks for. (No-op aliases for cleanliness.)
fs.copyFileSync(path.join(BRAND, "icon-32.png"), path.join(BRAND, "favicon-32.png"));
fs.copyFileSync(path.join(BRAND, "icon-16.png"), path.join(BRAND, "favicon-16.png"));
fs.copyFileSync(path.join(BRAND, "icon-48.png"), path.join(BRAND, "favicon-48.png"));

// ─── favicon.ico (multi-resolution) ─────────────────────────────────────
// sharp doesn't write .ico natively. We hand-roll a minimal ICONDIR / ICONDIRENTRY
// header pointing at the 16/32/48 PNG payloads — modern browsers happily
// read PNG-encoded ICOs.

function buildIco(pngs /* [{size, buf}] */) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type=1 (icon)
  header.writeUInt16LE(pngs.length, 4);  // count

  const entries = [];
  const payloads = [];
  let offset = 6 + 16 * pngs.length;

  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);  // width  (0 = 256)
    e.writeUInt8(size === 256 ? 0 : size, 1);  // height (0 = 256)
    e.writeUInt8(0, 2);                        // palette
    e.writeUInt8(0, 3);                        // reserved
    e.writeUInt16LE(1, 4);                     // color planes
    e.writeUInt16LE(32, 6);                    // bits per pixel
    e.writeUInt32LE(buf.length, 8);            // size of image data
    e.writeUInt32LE(offset, 12);               // offset
    entries.push(e);
    payloads.push(buf);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...payloads]);
}

const icoBufs = await Promise.all(
  [16, 32, 48].map(async (size) => ({
    size,
    buf: await sharp(Buffer.from(iconMarkSvg), { density: 600 })
      .resize(size, size, { fit: "contain" })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  })),
);
const ico = buildIco(icoBufs);
fs.writeFileSync(path.join(ROOT, "public", "favicon.ico"), ico);
console.log(`✓ favicon.ico (multi-res, ${ico.length} bytes)`);

// ─── PWA manifest ───────────────────────────────────────────────────────
const manifest = {
  id: "/",
  name: "My Agent Experience",
  short_name: "my · ax",
  description:
    "A personal AI agent operating environment you deploy on Cloudflare.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
  orientation: "any",
  background_color: BG,
  theme_color: BG,
  categories: ["productivity", "utilities"],
  launch_handler: { client_mode: "focus-existing" },
  protocol_handlers: [
    { protocol: "web+myax", url: "/?launch=%s" },
  ],
  shortcuts: [
    {
      name: "New chat",
      short_name: "New",
      url: "/?action=new",
      icons: [{ src: "/static/brand/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    {
      name: "Active jobs",
      short_name: "Jobs",
      url: "/?action=settings#jobs",
      icons: [{ src: "/static/brand/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    {
      name: "Notifications",
      short_name: "Attention",
      url: "/?action=attention",
      icons: [{ src: "/static/brand/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
  ],
  icons: [
    {
      src: "/static/brand/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/static/brand/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/static/brand/icon-maskable-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/static/brand/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/static/brand/icon-mark.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
};
fs.writeFileSync(
  path.join(BRAND, "manifest.webmanifest"),
  JSON.stringify(manifest, null, 2),
);
console.log("✓ manifest.webmanifest");

// ─── OG image (1200×630) ────────────────────────────────────────────────
// Composes the wordmark + tagline + a brand accent line. Rendered server-
// side once at deploy and served as a static PNG. Access-gated deployments
// may restrict unfurl fetches; the asset remains generic and safe to publish.

// OG image. Same per-glyph trick: three text elements, one ending-anchored,
// one centered, one start-anchored, so the wordmark visually centers around
// x=600 (canvas midpoint) regardless of glyph-advance variation.
const ogSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <style>${fontFace}
    .og-word {
      font-family: "Mozilla Headline", "Inter", system-ui, sans-serif;
      font-weight: 400;
      font-size: 160px;
    }
    .og-sub {
      font-family: "Inter", system-ui, sans-serif;
      font-weight: 400;
    }
  </style>
  <!-- Page bg -->
  <rect width="1200" height="630" fill="${BG}"/>

  <!-- Brand accent stripe along the top -->
  <rect x="0" y="0" width="1200" height="4" fill="${BRAND_ORANGE}"/>

  <!-- Wordmark — anchored around horizontal canvas center (x=600).
       Gaps tuned by eye to mirror the live UI rhythm where the dot reads
       as a punctuation-mark separator, not a divider. -->
  <text x="572" y="320" text-anchor="end" class="og-word" fill="${FG}">my</text>
  <text x="600" y="300" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="120" fill="${BRAND_ORANGE}">·</text>
  <text x="628" y="320" text-anchor="start" class="og-word" fill="${FG_MUT}">ax</text>

  <!-- Tagline, two lines, centered below the wordmark. -->
  <text x="600" y="420" text-anchor="middle" class="og-sub" font-size="28" fill="${FG_MUT}">
    A personal AI agent operating environment
  </text>
  <text x="600" y="460" text-anchor="middle" class="og-sub" font-size="28" fill="${FG_MUT}">
    you deploy on Cloudflare.
  </text>

  <!-- Tagline bottom-left -->
  <text x="80" y="572" class="og-sub" font-size="18" fill="${FG_MUT}" opacity="0.7">
    PERSONAL AGENT · CLOUDFLARE WORKERS
  </text>
</svg>`;

await sharp(Buffer.from(ogSvg), { density: 200 })
  .png({ compressionLevel: 9 })
  .toFile(path.join(BRAND, "og.png"));
const ogSize = fs.statSync(path.join(BRAND, "og.png")).size;
console.log(`✓ og.png (1200×630, ${(ogSize / 1024).toFixed(1)} KB)`);

console.log("\nDone. Brand assets:");
for (const f of fs.readdirSync(BRAND).sort()) {
  const s = fs.statSync(path.join(BRAND, f)).size;
  console.log(`  ${(s / 1024).toFixed(1).padStart(7)} KB  ${f}`);
}
console.log(
  `  ${(fs.statSync(path.join(ROOT, "public", "favicon.ico")).size / 1024).toFixed(1).padStart(7)} KB  public/favicon.ico`,
);
