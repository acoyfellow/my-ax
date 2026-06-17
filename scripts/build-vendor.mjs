import { cp, mkdir } from "node:fs/promises";

await mkdir("public/static/vendor", { recursive: true });
await Promise.all([
  cp("node_modules/rrweb-player/dist/index.mjs", "public/static/vendor/rrweb-player.mjs"),
  cp("node_modules/rrweb-player/dist/style.css", "public/static/vendor/rrweb-player.css"),
]);
console.log("✓ vendored rrweb-player assets");
