import type { Env } from "./types";
import {
  errorFingerprint,
  formatAutoIssueBody,
  formatAutoIssueTitle,
  parseErrorReportInput,
  type ErrorReportInput,
  type FiledErrorIssue,
} from "./error-report";
const ISSUE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface GithubIssueResult {
  number: number;
  html_url: string;
}

export async function fileOwnerErrorIssue(
  env: Env,
  ownerEmail: string,
  raw: unknown,
  post: typeof fetch = fetch,
): Promise<FiledErrorIssue | { skipped: "not-configured" } | { error: string }> {
  const input = parseErrorReportInput(raw);
  if (!input) return { error: "invalid error report" };
  const token = env.GITHUB_TOKEN?.trim();
  const repo = env.GITHUB_REPO?.trim() || "acoyfellow/my-ax";
  if (!token) return { skipped: "not-configured" };
  const fingerprint = await errorFingerprint(input);
  const claimed = await claimFingerprint(env, ownerEmail, fingerprint);
  if (!claimed.created && claimed.issue_number && claimed.issue_url) {
    const open = await githubIssueIsOpen(token, repo, claimed.issue_number, post);
    if (open) {
      await touchFingerprint(env, ownerEmail, fingerprint).catch(() => undefined);
      return { number: claimed.issue_number, url: claimed.issue_url, fingerprint, created: false };
    }
  }
  const created = await createGithubIssue(token, repo, input, fingerprint, post);
  await rememberFingerprint(env, ownerEmail, fingerprint, created);
  await import("./routes/desk").then((mod) => mod.ownerDeskUpsert(env, ownerEmail, {
    id: `error-${fingerprint}`,
    title: formatAutoIssueTitle(input),
    body: `${input.origin} ${input.message}`.slice(0, 800),
    href: created.html_url,
    status: "pending",
  })).catch(() => undefined);
  return { number: created.number, url: created.html_url, fingerprint, created: true };
}

export async function reportServerChatError(
  env: Env,
  ownerEmail: string,
  sessionId: string,
  error: unknown,
): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  const cause = err.cause instanceof Error ? err.cause.message : typeof err.cause === "string" ? err.cause : undefined;
  await fileOwnerErrorIssue(env, ownerEmail, {
    origin: "server",
    message: err.message,
    stack: err.stack,
    cause,
    sessionId,
    versionId: env.CF_VERSION_METADATA?.id,
  }).catch((reportError) => {
    console.error("error_issue_failed", { sessionId, err: String(reportError) });
  });
}

function cutoffSql(now = Date.now()): string {
  return new Date(now - ISSUE_WINDOW_MS).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

async function claimFingerprint(
  env: Env,
  ownerEmail: string,
  fingerprint: string,
): Promise<{ created: boolean; issue_number?: number; issue_url?: string }> {
  const owner = ownerEmail.toLowerCase();
  const insert = await env.DB.prepare(
    `INSERT OR IGNORE INTO error_issue_fingerprints(owner_email, fingerprint, issue_number, issue_url, first_seen_at, last_seen_at)
     VALUES (?, ?, 0, '', datetime('now'), datetime('now'))`,
  ).bind(owner, fingerprint).run();
  if ((insert.meta?.changes ?? 0) > 0) return { created: true };
  const existing = await env.DB.prepare(
    "SELECT issue_number, issue_url FROM error_issue_fingerprints WHERE owner_email = ? AND fingerprint = ? AND last_seen_at >= ?",
  ).bind(owner, fingerprint, cutoffSql()).first<{ issue_number: number; issue_url: string }>();
  return {
    created: false,
    issue_number: existing?.issue_number,
    issue_url: existing?.issue_url,
  };
}

async function touchFingerprint(env: Env, ownerEmail: string, fingerprint: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE error_issue_fingerprints SET last_seen_at = datetime('now') WHERE owner_email = ? AND fingerprint = ?",
  ).bind(ownerEmail.toLowerCase(), fingerprint).run();
}

async function rememberFingerprint(env: Env, ownerEmail: string, fingerprint: string, issue: GithubIssueResult): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO error_issue_fingerprints(owner_email, fingerprint, issue_number, issue_url, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(owner_email, fingerprint) DO UPDATE SET
       issue_number = excluded.issue_number,
       issue_url = excluded.issue_url,
       last_seen_at = datetime('now')`,
  ).bind(ownerEmail.toLowerCase(), fingerprint, issue.number, issue.html_url).run();
}

async function githubIssueIsOpen(token: string, repo: string, number: number, post = fetch): Promise<boolean> {
  const res = await post(`https://api.github.com/repos/${repo}/issues/${number}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "my-ax-error-report",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) return false;
  const json = await res.json().catch(() => ({})) as { state?: string };
  return json.state === "open";
}

export async function createGithubIssue(token: string, repo: string, input: ErrorReportInput, fingerprint: string, post = fetch): Promise<GithubIssueResult> {
  const res = await post(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "my-ax-error-report",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: formatAutoIssueTitle(input),
      body: formatAutoIssueBody(input, fingerprint),
      labels: ["bug"],
    }),
  });
  const json = await res.json().catch(() => ({})) as { number?: number; html_url?: string; message?: string };
  if (!res.ok || !json.number || !json.html_url) {
    throw new Error(`github issue ${res.status} ${json.message || ""}`.trim());
  }
  return { number: json.number, html_url: json.html_url };
}
