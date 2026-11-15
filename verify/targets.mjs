import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SCRATCH = join(REPO, ".git");

function privateTargets() {
  const file = join(SCRATCH, "verify-targets.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function resolveTarget(name) {
  const known = { local: "http://127.0.0.1:8799", ...privateTargets() };
  if (process.env.MYAX_PREVIEW_URL) known.preview = process.env.MYAX_PREVIEW_URL;
  if (process.env.MYAX_PROD_URL) known.prod = process.env.MYAX_PROD_URL;
  const value = known[name] ?? (/^https?:\/\//.test(name ?? "") ? name : "");
  return value.replace(/\/$/, "");
}

export function browserPaths() {
  const playwright = process.env.PLAYWRIGHT_CORE ?? join(SCRATCH, "pw", "node_modules", "playwright-core", "index.mjs");
  const chrome = process.env.CHROME_PATH ?? join(homedir(), "Library", "Caches", "ms-playwright", "chromium-1254", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
  const out = process.env.SCREEN_OUT ?? join(SCRATCH, "screens");
  return { playwright, chrome, out };
}
