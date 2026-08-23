import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "./types";
import { fileOwnerErrorIssue } from "./error-issue";
import { errorFingerprint } from "./error-report";

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
            const [owner, fingerprint, cutoff] = bound as [string, string, string | undefined];
            const hit = rows.find((row) => row.fingerprint === fingerprint && (cutoff === undefined || row.lastSeen >= cutoff));
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

test("a concurrent report for one fingerprint files exactly one issue", async () => {
  const { env } = makeEnv({ token: "t" });
  let created = 0;
  let firstIsCreating: (() => void) | undefined;
  const firstReachedGithub = new Promise<void>((resolve) => { firstIsCreating = resolve; });
  let releaseFirst: (() => void) | undefined;
  const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const post: typeof fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      created += 1;
      const number = 200 + created;
      if (created === 1) {
        firstIsCreating?.();
        await firstMayFinish;
      }
      return new Response(JSON.stringify({ number, html_url: `https://github.com/acoyfellow/my-ax/issues/${number}` }), { status: 201 });
    }
    if (/\/issues\/0$/.test(String(url))) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ state: "open" }), { status: 200 });
  }) as unknown as typeof fetch;

  const input = {
    origin: "client" as const,
    message: "Invalid URL string.",
    stack: "Error: Invalid URL string.\n    at buildUrl (index.js:1:1)",
  };

  const a = fileOwnerErrorIssue(env, "owner@example.com", input, post);
  await firstReachedGithub;
  const b = fileOwnerErrorIssue(env, "owner@example.com", input, post);
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseFirst?.();
  const [ra, rb] = await Promise.all([a, b]);

  assert.equal(created, 1, "the second report must not create a second GitHub issue");
  const numbers = [ra, rb].map((r) => ("number" in r ? r.number : null));
  assert.equal(numbers[0], numbers[1], "both reports must return the same issue number");
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
  let creates = 0;
  const second = await fileOwnerErrorIssue(secondEnv.env, "owner@example.com", {
    origin: "server",
    message: "Invalid URL string.",
    stack: "Error: Invalid URL string.\n    at later (agent.ts:9:9)",
  }, async (url, init) => {
    if (init?.method === "POST") creates += 1;
    if (String(url).endsWith("/issues/61")) {
      return new Response(JSON.stringify({ state: "open" }), { status: 200 });
    }
    return new Response("{}", { status: 500 });
  });
  assert.equal(creates, 0);
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
  let creates = 0;
  const second = await fileOwnerErrorIssue(env, "owner@example.com", {
    origin: "client",
    message: "The image data you provided does not represent a valid image.",
  }, async (url, init) => {
    if (init?.method === "POST") creates += 1;
    if (String(url).includes("/issues/") && init?.method !== "POST") {
      return new Response(JSON.stringify({ state: "open" }), { status: 200 });
    }
    return new Response(JSON.stringify({ number: 70, html_url: "https://github.com/acoyfellow/my-ax/issues/70" }), { status: 201 });
  });
  assert.equal(creates, 0);
  assert.equal("created" in second && second.created, false);
});

test("a closed fingerprint opens a new issue", async () => {
  const input = {
    origin: "client" as const,
    message: "The image data you provided does not represent a valid image. Please check your input and try again with one of the supported image formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].",
  };
  const fingerprint = await errorFingerprint(input);
  const { env } = makeEnv({
    token: "t",
    existing: {
      fingerprint,
      number: 69,
      url: "https://github.com/acoyfellow/my-ax/issues/69",
      lastSeen: "2099-01-01 00:00:00",
    },
  });
  let created = 0;
  const result = await fileOwnerErrorIssue(env, "owner@example.com", input, async (url, init) => {
    const href = String(url);
    if (href.endsWith("/issues/69")) return new Response(JSON.stringify({ state: "closed" }), { status: 200 });
    if (init?.method === "POST") {
      created += 1;
      return new Response(JSON.stringify({ number: 90, html_url: "https://github.com/acoyfellow/my-ax/issues/90" }), { status: 201 });
    }
    return new Response("{}", { status: 500 });
  });
  assert.equal(created, 1);
  assert.deepEqual(result, {
    number: 90,
    url: "https://github.com/acoyfellow/my-ax/issues/90",
    fingerprint,
    created: true,
  });
});

test("invalid body is rejected", async () => {
  const { env } = makeEnv({ token: "t" });
  const result = await fileOwnerErrorIssue(env, "owner@example.com", { origin: "nope" });
  assert.deepEqual(result, { error: "invalid error report" });
});
