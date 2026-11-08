import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const ALLOW_PATH = join(ROOT, "scripts", "rpc-audit.allow.json");

const STUB_ACQUIRE = /\bgetAgentByName\(|\bgetSubAgentByName\(|\.idFromName\(|\bgetSessionAgent\(|\bworkspaceHub\(|\bgetNamedComputer\(|\bgetSandbox\(/;
const WRAPPED = /\bwithTimeout\(|\bwithRetry\(|\bresolveStub\(|\brpc(Contract)?\.(query|command|idempotentCommand|startJob)\(/;
const WINDOW = 8;
const WRAPPER_LOOKBACK = 2;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "rpc" ? [] : sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name) || name.endsWith(".d.ts")) return [];
    return [path];
  });
}

function loadAllow() {
  const entries = JSON.parse(readFileSync(ALLOW_PATH, "utf8"));
  for (const entry of entries) {
    if (!entry.file || !entry.match || typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
      throw new Error(`allowlist entry needs file, match and a reason of 20+ characters: ${JSON.stringify(entry)}`);
    }
  }
  return entries;
}

function allowed(allow, file, line, used) {
  const index = allow.findIndex((entry) => entry.file === file && line.includes(entry.match));
  if (index >= 0) used.add(index);
  return index >= 0;
}

function isComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

export function audit(files, readText, allow) {
  const violations = [];
  const used = new Set();
  for (const path of files) {
    const file = relative(ROOT, path);
    const text = readText(path);
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (isComment(line)) return;
      const at = `${file}:${index + 1}`;
      if (line.includes("AbortSignal.timeout(")) violations.push({ rule: "R1", at, detail: "AbortSignal.timeout cannot be cleared; use a cleared setTimeout or withTimeout" });
      if (/retryOnTimeout:\s*true/.test(line) && !/opId/.test(lines.slice(Math.max(0, index - WINDOW), index + WINDOW).join("\n"))) {
        violations.push({ rule: "R3", at, detail: "retryOnTimeout without an opId can run the method twice" });
      }
      if (STUB_ACQUIRE.test(line) && !/^\s*(export\s+)?(async\s+)?function\b/.test(line) && !/^\s*import\b/.test(line)) {
        const near = lines.slice(Math.max(0, index - WRAPPER_LOOKBACK), index + WINDOW).join("\n");
        if (!WRAPPED.test(near) && !allowed(allow, file, line, used)) {
          violations.push({ rule: "R2", at, detail: `Durable Object call without withTimeout/withRetry or an allowlist reason: ${line.trim().slice(0, 120)}` });
        }
      }
    });
    if (/Promise\.race\(/.test(text) && /setTimeout\(/.test(text) && !/clearTimeout\(/.test(text)) {
      violations.push({ rule: "R4", at: file, detail: "a race against setTimeout never clears the timer" });
    }
  }
  const stale = allow.filter((_, index) => !used.has(index)).map((entry) => ({ rule: "ALLOW", at: entry.file, detail: `allowlist entry matches nothing: ${entry.match}` }));
  return [...violations, ...stale];
}

export function machinectlCarriesOpId(hostText) {
  return /type:\s*"call"[^}]*\bopId\b/.test(hostText);
}

export function machinectlCancelsOnTimeout(hostText) {
  const start = hostText.indexOf("setTimeout(() => {");
  const end = start < 0 ? -1 : hostText.indexOf("CALL_TIMEOUT_MS)", start);
  const timeoutBlock = start < 0 || end < 0 ? "" : hostText.slice(start, end);
  return /cancelLaptopCall\(/.test(timeoutBlock) && /type: \\?"cancel\\?"/.test(hostText) && /may still finish/i.test(hostText);
}

function main() {
  const files = sourceFiles(SRC);
  const violations = audit(files, (path) => readFileSync(path, "utf8"), loadAllow());
  const hostText = readFileSync(join(SRC, "machinectl-host.ts"), "utf8");
  if (!machinectlCarriesOpId(hostText)) violations.push({ rule: "R5", at: "src/machinectl-host.ts", detail: "machinectl call frames carry no opId, so a timed-out call can run twice on the laptop" });
  if (!machinectlCancelsOnTimeout(hostText)) violations.push({ rule: "R5", at: "src/machinectl-host.ts", detail: "a timed-out machinectl call must send cancel and warn that it may still finish" });
  for (const violation of violations) console.log(`${violation.rule} ${violation.at} ${violation.detail}`);
  const byRule = violations.reduce((counts, violation) => ({ ...counts, [violation.rule]: (counts[violation.rule] ?? 0) + 1 }), {});
  console.log(`files: ${files.length} violations: ${violations.length} ${JSON.stringify(byRule)}`);
  const blocking = violations.filter((violation) => ENFORCED_RULES.has(violation.rule));
  console.log(`blocking: ${blocking.length} (enforced: ${[...ENFORCED_RULES].join(",")})`);
  process.exitCode = blocking.length === 0 ? 0 : 1;
}

export const ENFORCED_RULES = new Set(["R1", "R2", "R3", "R4", "R5", "ALLOW"]);

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
