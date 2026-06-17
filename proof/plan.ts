// my-ax smoke proof loop.
//
// Reusable claim-and-prove harness against a deployed my-ax worker.
// Vanilla fetch + assert. No external dependencies. Authenticates via a
// Cloudflare Access service token when you front the worker with Access.
//
// Run:
//   MY_AX_BASE_URL=https://your-host bun proof/plan.ts
//   # or:
//   npm run prove
//
// Env:
//   MY_AX_BASE_URL           — required, e.g. https://ax.example.com
//   CF_ACCESS_CLIENT_ID      — Cloudflare Access service token client id (if fronted by Access)
//   CF_ACCESS_CLIENT_SECRET  — Cloudflare Access service token client secret
//
// On pass: human-readable summary, JSON receipt, exit 0.
// On fail: per-gate detail, JSON receipt, exit 1.

export {};

// Allow .dev.vars to supply the service-token credentials without forcing
// callers to `export` them by hand. Only used when env vars are absent.
function loadDevVars(): Record<string, string> {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const file = path.join(__dirname, "..", ".dev.vars");
    if (!fs.existsSync(file)) return {};
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}
const devVars = loadDevVars();

const BASE_URL = process.env.MY_AX_BASE_URL ?? devVars.MY_AX_BASE_URL ?? "";
const CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID ?? devVars.CF_ACCESS_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET ?? devVars.CF_ACCESS_CLIENT_SECRET ?? "";

if (!BASE_URL) {
  console.error("MY_AX_BASE_URL required (e.g. https://ax.example.com)");
  process.exit(2);
}

const authHeaders: Record<string, string> = {
  "CF-Access-Client-Id": CLIENT_ID,
  "CF-Access-Client-Secret": CLIENT_SECRET,
};

interface GateResult {
  id: string;
  title: string;
  status: "pass" | "fail";
  durationMs: number;
  details: Record<string, unknown>;
  failures: string[];
}

async function runGate(
  id: string,
  title: string,
  fn: () => Promise<{ details: Record<string, unknown>; failures: string[] }>,
): Promise<GateResult> {
  const t0 = Date.now();
  try {
    const { details, failures } = await fn();
    return {
      id,
      title,
      status: failures.length === 0 ? "pass" : "fail",
      durationMs: Date.now() - t0,
      details,
      failures,
    };
  } catch (err) {
    return {
      id,
      title,
      status: "fail",
      durationMs: Date.now() - t0,
      details: {},
      failures: [`exception: ${(err as Error).message}`],
    };
  }
}

function expect(failures: string[], cond: boolean, msg: string) {
  if (!cond) failures.push(msg);
}

// ─── Gates ──────────────────────────────────────────────────────────────────

async function gateEdgeAlive(): Promise<GateResult> {
  return runGate(
    "edge-alive",
    "Edge routes the configured host to a worker (anonymous → 302 to Access)",
    async () => {
      const res = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      const failures: string[] = [];
      expect(failures, res.status === 302, `expected 302, got ${res.status}`);
      const loc = res.headers.get("location") ?? "";
      const baseHost = new URL(BASE_URL).host;
      const redirectsAway = /^https:\/\//.test(loc) && !loc.startsWith(BASE_URL) && !loc.includes(baseHost);
      expect(
        failures,
        redirectsAway,
        `expected 302 to an external SSO host, got ${loc.slice(0, 80)}`,
      );
      return {
        details: { status: res.status, redirectsToAccess: redirectsAway },
        failures,
      };
    },
  );
}

async function gateServiceTokenAdmitted(): Promise<GateResult> {
  return runGate(
    "service-token-admitted",
    "Access admits the my-ax-smoke-prober service token at /api/health",
    async () => {
      const res = await fetch(`${BASE_URL}/api/health`, {
        headers: authHeaders,
        redirect: "manual",
      });
      const failures: string[] = [];
      expect(failures, res.status === 200, `expected 200, got ${res.status}`);
      return { details: { status: res.status }, failures };
    },
  );
}

async function gateHealthBodyOk(): Promise<GateResult> {
  return runGate(
    "health-body-ok",
    "/api/health reports ok with all bindings present and no missing secrets",
    async () => {
      const res = await fetch(`${BASE_URL}/api/health`, { headers: authHeaders });
      const failures: string[] = [];
      if (res.status !== 200) {
        failures.push(`expected 200, got ${res.status}`);
        return { details: { status: res.status }, failures };
      }
      const body = (await res.json()) as {
        ok: boolean;
        name: string;
        version: string | null;
        region: string | null;
        bindings: Record<string, boolean>;
        requiredSecretsMissing: string[];
      };
      expect(failures, body.ok === true, `expected ok=true, got ${body.ok}`);
      expect(failures, body.name === "my-ax", `expected name="my-ax", got ${body.name}`);
      expect(
        failures,
        body.requiredSecretsMissing.length === 0,
        `missing required secrets: ${body.requiredSecretsMissing.join(", ") || "(none)"}`,
      );
      const requiredBindings = [
        "USER_AGENT",
        "OAUTH_CLIENT",
        "SANDBOX",
        "DB",
        "AUDIT_KV",
        "BACKUP_BUCKET",
        "USER_UPLOADS",
        "AI",
        "BROWSER",
        "LOADER",
      ];
      for (const k of requiredBindings) {
        expect(failures, body.bindings[k] === true, `binding ${k} missing`);
      }
      return {
        details: {
          version: body.version,
          region: body.region,
          bindings: body.bindings,
          requiredSecretsMissing: body.requiredSecretsMissing,
        },
        failures,
      };
    },
  );
}

async function gatePolicyEnforced(): Promise<GateResult> {
  return runGate(
    "policy-enforced",
    "Without the service token, /api/health is still gated by Access (302)",
    async () => {
      const res = await fetch(`${BASE_URL}/api/health`, { redirect: "manual" });
      const failures: string[] = [];
      expect(failures, res.status === 302, `expected 302, got ${res.status}`);
      const loc = res.headers.get("location") ?? "";
      const baseHost = new URL(BASE_URL).host;
      const redirectsAway = /^https:\/\//.test(loc) && !loc.startsWith(BASE_URL) && !loc.includes(baseHost);
      expect(
        failures,
        redirectsAway,
        `expected 302 to an external SSO host, got ${loc.slice(0, 80)}`,
      );
      return {
        details: { status: res.status, redirectsToAccess: redirectsAway },
        failures,
      };
    },
  );
}

// ─── Runner ─────────────────────────────────────────────────────────────────

const gates = [gateEdgeAlive, gateServiceTokenAdmitted, gateHealthBodyOk, gatePolicyEnforced];

const startedAt = new Date().toISOString();
const results: GateResult[] = [];
for (const gate of gates) {
  const r = await gate();
  results.push(r);
}
const finishedAt = new Date().toISOString();

const overallPass = results.every((r) => r.status === "pass");

// ─── Output ─────────────────────────────────────────────────────────────────

const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[90m",
  bold: "\x1b[1m",
};

console.log("");
console.log(`${ANSI.bold}my-ax smoke proof${ANSI.reset}  ${ANSI.dim}${BASE_URL}${ANSI.reset}`);
console.log("");
for (const r of results) {
  const tag =
    r.status === "pass"
      ? `${ANSI.green}PASS${ANSI.reset}`
      : `${ANSI.red}FAIL${ANSI.reset}`;
  console.log(`  ${tag}  ${r.id.padEnd(24)}  ${ANSI.dim}${r.durationMs}ms${ANSI.reset}  ${r.title}`);
  for (const f of r.failures) {
    console.log(`        ${ANSI.red}↳ ${f}${ANSI.reset}`);
  }
}
console.log("");
const healthDetails = results.find((r) => r.id === "health-body-ok")?.details ?? {};
if (healthDetails.version) {
  console.log(
    `  ${ANSI.dim}worker version:${ANSI.reset} ${healthDetails.version}   ${ANSI.dim}region:${ANSI.reset} ${healthDetails.region}`,
  );
}
console.log(
  `  ${ANSI.dim}gates:${ANSI.reset} ${results.filter((r) => r.status === "pass").length}/${results.length}   ${ANSI.dim}status:${ANSI.reset} ${
    overallPass ? `${ANSI.green}pass${ANSI.reset}` : `${ANSI.red}fail${ANSI.reset}`
  }`,
);
console.log("");

if (process.env.PROOF_JSON === "1") {
  console.log(
    JSON.stringify({ name: "my-ax-smoke", startedAt, finishedAt, baseUrl: BASE_URL, status: overallPass ? "pass" : "fail", results }, null, 2),
  );
}

if (!overallPass) process.exit(1);
