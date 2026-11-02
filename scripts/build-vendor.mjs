import { cp, mkdir } from "node:fs/promises";

await mkdir("public/static/vendor", { recursive: true });
await Promise.all([
  cp("node_modules/rrweb-player/dist/rrweb-player.js", "public/static/vendor/rrweb-player.mjs"),
  cp("node_modules/rrweb-player/dist/style.css", "public/static/vendor/rrweb-player.css"),
]);
console.log("✓ vendored rrweb-player assets");
