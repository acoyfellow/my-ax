import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "./types";
import { fileOwnerErrorIssue } from "./error-issue";

function makeEnv(opts: { token?: string; existing?: { fingerprint: string; number: number; url: string; lastSeen: string } } = {}) {
  const rows = opts.existing ? [opts.existing] : [];
  const updates: unknown[][] = [];
  const inserts: unknown[][] = [];
  const desk: unknown[] = [];
  const db = {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, " ").trim();
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first<T = unknown>() {
          if (/FROM error_issue_fingerprints/.test(q)) {
            const [owner, fingerprint, cutoff] = bound as [string, string, string];
            const hit = rows.find((row) => row.fingerprint === fingerprint && row.lastSeen >= cutoff);
            void owner;
            return (hit ? { issue_number: hit.number, issue_url: hit.url } : null) as T;
          }
          return null as T;
        },
        async run() {
          if (/UPDATE error_issue_fingerprints/.test(q)) updates.push(bound);
          if (/INSERT OR IGNORE INTO error_issue_fingerprints/.test(q)) {
            const fingerprint = String(bound[1] || "");
            const hit = rows.find((row) => row.fingerprint === fingerprint);
            if (hit) return { meta: { changes: 0 } };
            rows.push({ fingerprint, number: 0, url: "", lastSeen: "2099-01-01 00:00:00" });
            inserts.push(bound);
            return { meta: { changes: 1 } };
          }
          if (/INSERT INTO error_issue_fingerprints/.test(q)) {
            inserts.push(bound);
            const fingerprint = String(bound[1] || "");
            const hit = rows.find((row) => row.fingerprint === fingerprint);
            if (hit) {
              hit.number = Number(bound[2]);
              hit.url = String(bound[3]);
            }
          }
          if (/INSERT INTO owner_preferences/.test(q)) desk.push(bound);
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  const env = {
    DB: db,
    GITHUB_TOKEN: opts.token,
    GITHUB_REPO: "acoyfellow/my-ax",
    CF_VERSION_METADATA: { id: "ver-1", timestamp: "t" },
  } as unknown as Env;
  return { env, updates, inserts, desk };
}

test("missing token skips without throwing", async () => {
  const { env } = makeEnv();
  const result = await fileOwnerErrorIssue(env, "owner@example.com", {
    origin: "server",
    message: "Invalid URL string.",
  });
  assert.deepEqual(result, { skipped: "not-configured" });
});

test("same fingerprint reuses the open issue", async () => {
  const firstEnv = makeEnv({ token: "t" });
  const first = await fileOwnerErrorIssue(firstEnv.env, "owner@example.com", {
    origin: "server",
    message: "Invalid URL string.",
    stack: "Error: Invalid URL string.\n    at buildUrl (agent.ts:1:1)",
  }, async () => new Response(JSON.stringify({ number: 61, html_url: "https://github.com/acoyfellow/my-ax/issues/61" }), { status: 201 }));
  if (!("fingerprint" in first)) throw new Error("expected fingerprint");
  assert.equal(first.created, true);
  assert.equal(firstEnv.inserts.length, 2);
  const secondEnv = makeEnv({
    token: "t",
    existing: {
      fingerprint: first.fingerprint,
      number: 61,
      url: "https://github.com/acoyfellow/my-ax/issues/61",
      lastSeen: "2099-01-01 00:00:00",
    },
  });
  let posts = 0;
  const second = await fileOwnerErrorIssue(secondEnv.env, "owner@example.com", {
    origin: "server",
    message: "Invalid URL string.",
    stack: "Error: Invalid URL string.\n    at later (agent.ts:9:9)",
  }, async () => {
    posts += 1;
    return new Response("{}", { status: 500 });
  });
  assert.equal(posts, 0);
  assert.deepEqual(second, {
    number: 61,
    url: "https://github.com/acoyfellow/my-ax/issues/61",
    fingerprint: first.fingerprint,
    created: false,
  });
  assert.equal(secondEnv.inserts.length, 0);
  assert.equal(secondEnv.updates.length, 1);
});

test("a second racer does not create after the first claim", async () => {
  const { env } = makeEnv({ token: "t" });
  const first = await fileOwnerErrorIssue(env, "owner@example.com", {
    origin: "client",
    message: "The image data you provided does not represent a valid image.",
  }, async () => new Response(JSON.stringify({ number: 69, html_url: "https://github.com/acoyfellow/my-ax/issues/69" }), { status: 201 }));
  if (!("fingerprint" in first)) throw new Error("expected fingerprint");
  let posts = 0;
  const second = await fileOwnerErrorIssue(env, "owner@example.com", {
    origin: "client",
    message: "The image data you provided does not represent a valid image.",
  }, async () => {
    posts += 1;
    return new Response(JSON.stringify({ number: 70, html_url: "https://github.com/acoyfellow/my-ax/issues/70" }), { status: 201 });
  });
  assert.equal(posts, 0);
  assert.equal("created" in second && second.created, false);
});

test("invalid body is rejected", async () => {
  const { env } = makeEnv({ token: "t" });
  const result = await fileOwnerErrorIssue(env, "owner@example.com", { origin: "nope" });
  assert.deepEqual(result, { error: "invalid error report" });
});
