export type ErrorOrigin = "client" | "server";

export interface ErrorReportInput {
  origin: ErrorOrigin;
  message: string;
  stack?: string;
  cause?: string;
  href?: string;
  sessionId?: string;
  versionId?: string;
}

export interface FiledErrorIssue {
  number: number;
  url: string;
  fingerprint: string;
  created: boolean;
}

const FINGERPRINT_RE = /^[a-f0-9]{16}$/;
const MAX_MESSAGE = 240;
const MAX_STACK = 1500;
const MAX_CAUSE = 400;
const MAX_HREF = 2048;
const MAX_SESSION = 80;
const MAX_VERSION = 80;

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeErrorMessage(message: string): string {
  const text = clip(message, MAX_MESSAGE) || "unknown error";
  if (/invalid url string/i.test(text)) return "Invalid URL string.";
  if (/does not represent a valid image/i.test(text)) {
    return "The image data you provided does not represent a valid image.";
  }
  if (/no response from the agent for \d+s, and no tool is running/i.test(text)) {
    return "No response from the agent, and no tool is running. The turn may have failed. Send another message to retry or steer.";
  }
  return text.replace(/\s+/g, " ");
}

export function stackFingerprintSite(stack: string): string {
  const lines = stack.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const site = line.match(/([A-Za-z0-9._/-]+\.(?:ts|js|svelte|mjs)(?::\d+(?::\d+)?)?)/i);
    if (site?.[1] && !/node:|node_modules/i.test(site[1])) {
      return site[1].replace(/:\d+:\d+$/, "").replace(/^\(+/, "");
    }
  }
  return "unknown";
}

export async function errorFingerprint(input: Pick<ErrorReportInput, "origin" | "message" | "stack">): Promise<string> {
  const message = normalizeErrorMessage(input.message);
  const site = stackFingerprintSite(input.stack ?? "");
  const material = `${input.origin}\n${message}\n${site}`;
  const bytes = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export function parseErrorReportInput(raw: unknown): ErrorReportInput | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const origin = body.origin === "client" || body.origin === "server" ? body.origin : null;
  const message = clip(body.message, MAX_MESSAGE);
  if (!origin || !message) return null;
  const sessionId = clip(body.sessionId, MAX_SESSION);
  const href = clip(body.href, MAX_HREF);
  const versionId = clip(body.versionId, MAX_VERSION);
  return {
    origin,
    message,
    stack: clip(body.stack, MAX_STACK) || undefined,
    cause: clip(body.cause, MAX_CAUSE) || undefined,
    href: href || undefined,
    sessionId: sessionId || undefined,
    versionId: versionId || undefined,
  };
}

export function formatAutoIssueTitle(input: Pick<ErrorReportInput, "message">): string {
  return `bug: ${normalizeErrorMessage(input.message)}`;
}

export function formatAutoIssueBody(input: ErrorReportInput, fingerprint: string): string {
  const site = stackFingerprintSite(input.stack ?? "");
  return [
    "## Auto error report",
    "",
    `fingerprint: \`${fingerprint}\``,
    `origin: ${input.origin}`,
    `message: ${normalizeErrorMessage(input.message)}`,
    ...(site !== "unknown" ? [`site: ${site}`] : []),
    "",
    "This issue was opened by My AX from a live error. One fingerprint is one issue.",
    "This report opts in a ready PR. The factory opens the head branch and the pull request.",
  ].join("\n");
}

export function isErrorFingerprint(value: string): boolean {
  return FINGERPRINT_RE.test(value);
}
