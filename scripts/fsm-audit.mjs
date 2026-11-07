import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

export const MACHINES = [
  { name: "sessions", owner: "src/fsm/session-status.ts", writer: /UPDATE sessions SET status\b/ },
  { name: "runs", owner: "src/fsm/run-status.ts", writer: /UPDATE runs SET status\b/ },
  { name: "jobs", owner: "src/fsm/job-status.ts", writer: /UPDATE jobs SET[^"`]*\bstatus\s*=|^\s*status = CASE WHEN max_runs|status: "(active|paused|exhausted)" as const/ },
  { name: "recipes", owner: "src/fsm/recipe-status.ts", writer: /\bpatch\.status\s*=|body\.status === "enabled" \? "enabled"/ },
  { name: "attention", owner: "src/fsm/attention-item.ts", writer: /UPDATE attention_items SET (seen_at|dismissed_at)\b/ },
  { name: "desk", owner: "src/fsm/desk-card.ts", writer: /status: Object\.hasOwn\(raw, "status"\)/ },
  { name: "workspace-verified", owner: "src/fsm/workspace-verification.ts", writer: /\bverified\s*=\s*(true|false)\b/, files: /^src\/workspace-lifecycle\.ts$/ },
  { name: "machinehost", owner: "src/fsm/machine-connection.ts", writer: /storage\.(put|delete)\([^)]*SOCKET_GENERATION_KEY/ },
  { name: "websocket", owner: "src/fsm/socket-connection.ts", writer: /\b(manuallyClosed|exhausted)\s*=\s*(true|false)\b/, files: /^src\/ui\/reconnecting-socket\.ts$/ },
  { name: "chat-message", owner: "src/fsm/chat-message.ts", writer: /\b(streaming|pending):\s*(true|false)\b|\.(streaming|pending)\s*=\s*(true|false)\b/, files: /^src\/ui\/Chat\.svelte$/ },
  { name: "voice", owner: "src/fsm/voice-status.ts", writer: /=\s*"idle"\s*\|\s*"listening"\s*\|\s*"thinking"\s*\|\s*"speaking"/ },
];

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fsm" ? [] : sourceFiles(path);
    if (!/\.(ts|tsx|svelte)$/.test(name) || /\.test\.tsx?$/.test(name) || name.endsWith(".d.ts")) return [];
    return [path];
  });
}

export function audit(files, read) {
  const violations = [];
  for (const path of files) {
    const file = relative(ROOT, path).split("\\").join("/");
    const lines = read(path).split("\n");
    for (const machine of MACHINES) {
      if (machine.files && !machine.files.test(file)) continue;
      lines.forEach((line, index) => {
        if (machine.writer.test(line)) violations.push({ machine: machine.name, at: `${file}:${index + 1}`, line: line.trim().slice(0, 140) });
      });
    }
  }
  return violations;
}

function main() {
  const violations = audit(sourceFiles(SRC), (path) => readFileSync(path, "utf8"));
  for (const violation of violations) console.log(`${violation.machine} ${violation.at} ${violation.line}`);
  const counts = Object.fromEntries(MACHINES.map((machine) => [machine.name, violations.filter((violation) => violation.machine === machine.name).length]));
  console.log(`fsm writers outside src/fsm: ${violations.length} ${JSON.stringify(counts)}`);
  process.exitCode = violations.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
