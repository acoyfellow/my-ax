import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const widget = readFileSync(new URL("./CodeDiffWidget.svelte", import.meta.url), "utf8");
const embed = readFileSync(new URL("./embed.ts", import.meta.url), "utf8");
const build = readFileSync(new URL("./build.mjs", import.meta.url), "utf8");

assert.match(widget, /const pierreDiffsModule = "@my-ax\/pierre-diffs"/);
assert.match(widget, /import\(pierreDiffsModule\)/);
assert.doesNotMatch(widget, /void import\("@pierre\/diffs"\)/);
assert.match(widget, /host\.clientWidth < 720 \? "unified" : "split"/);
assert.match(widget, /host\.clientWidth < 720 \? "wrap" : "scroll"/);
assert.match(widget, /prefers-color-scheme: dark/);
assert.match(widget, /document\.documentElement\.classList\.contains\("dark"\)/);
assert.match(widget, /document\.documentElement\.classList\.contains\("light"\)/);
assert.match(widget, /media\.addEventListener\("change", update\)/);
assert.match(widget, /media\.removeEventListener\("change", update\)/);
assert.match(widget, /new ResizeObserver\(update\)/);
assert.match(widget, /new MutationObserver\(update\)/);
assert.match(widget, /observer\?\.disconnect\(\)/);
assert.match(widget, /themeObserver\?\.disconnect\(\)/);
assert.match(widget, /instance\?\.cleanUp\(\)/);
assert.match(widget, /host\?\.replaceChildren\(\)/);
assert.doesNotMatch(widget, /\{diff\.oldText\}\\n--- changed to ---\\n\{diff\.newText\}/);
assert.match(embed, /"@my-ax\/pierre-diffs": withBuildId\(assetUrl\("pierre-diffs", "js"\), buildId\)/);
assert.match(build, /entryPoints: \[here\("pierre-diffs-client\.ts"\)\]/);
assert.match(build, /"pierre-diffs": \$\{pierreBundle\}/);

console.log("✓ code diff widget lazy, responsive, theme, and cleanup contract");
