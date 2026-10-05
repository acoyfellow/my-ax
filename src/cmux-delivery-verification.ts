export type MachineFn = (input: unknown) => Promise<unknown>;
export type MachineFns = Record<string, MachineFn>;

export type UnverifiedReceipt = { ok: false; verified: false; reason: string; result?: unknown };
export type PromptReceipt =
  | { ok: true; verified: true; cursor: { before: number; after: number }; freshTurn: string; result: unknown }
  | UnverifiedReceipt;
export type FocusReceipt =
  | { ok: true; verified: true; frontmostWorkspaceId: string; result: unknown }
  | UnverifiedReceipt;

export type VerificationOptions = {
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
};

const PROMPT_TOOLS = new Set(["cmux_pi_prompt", "cmux_pi_steer", "cmux_pi_follow_up"]);
const CURSOR_ANCHOR_CHARS = 240;
const TAIL_LINES = 200;
const USER_TURN_PREFIX = /^(?:>|❯|›|»|\$|user:|you:)\s*/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(value: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

export function tailText(value: unknown): string | null {
  if (typeof value === "string") return value;
  const fields = record(value);
  return fields ? stringField(fields, ["tail", "text", "content", "output"]) : null;
}

export function contentAfterCursor(before: string, after: string): string | null {
  if (before.length === 0) return after;
  if (after.startsWith(before)) return after.slice(before.length);
  const anchor = before.slice(-CURSOR_ANCHOR_CHARS);
  const index = after.lastIndexOf(anchor);
  return index < 0 ? null : after.slice(index + anchor.length);
}

export function findFreshUserTurn(fresh: string, message: string): string | null {
  const expected = message.trim();
  if (!expected) return null;
  for (const line of fresh.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === expected || trimmed.replace(USER_TURN_PREFIX, "") === expected) return trimmed;
  }
  return null;
}

export function isVerifiedPromptTool(name: string): boolean {
  return PROMPT_TOOLS.has(name);
}

export function isFocusTool(name: string): boolean {
  return /^cmux_.*focus/.test(name);
}

function promptMessage(args: Record<string, unknown>): string | null {
  return stringField(args, ["message", "text", "prompt"]);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function verifiedPrompt(
  send: MachineFn,
  readTail: MachineFn | undefined,
  input: unknown,
  options: VerificationOptions = {},
): Promise<PromptReceipt> {
  const args = record(input) ?? {};
  const message = promptMessage(args);
  if (!message) return { ok: false, verified: false, reason: "message is required" };
  if (!readTail) return { ok: false, verified: false, reason: "no cmux tail reader is published, so delivery cannot be verified" };
  const tailArgs = { workspaceId: args.workspaceId, surfaceId: args.surfaceId, lines: TAIL_LINES };
  const before = tailText(await readTail(tailArgs));
  if (before === null) return { ok: false, verified: false, reason: "could not capture the terminal cursor before sending" };
  const result = await send(input);
  const attempts = Math.max(1, options.attempts ?? 6);
  const sleep = options.sleep ?? defaultSleep;
  let reason = "no new content appeared after the cursor";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(options.intervalMs ?? 500);
    const after = tailText(await readTail(tailArgs));
    if (after === null) { reason = "terminal tail was unreadable after sending"; continue; }
    const fresh = contentAfterCursor(before, after);
    if (fresh === null) { reason = "terminal cursor was lost, so fresh content cannot be distinguished from stale content"; continue; }
    const freshTurn = findFreshUserTurn(fresh, message);
    if (freshTurn) return { ok: true, verified: true, cursor: { before: before.length, after: after.length }, freshTurn, result };
    reason = fresh.trim() ? "new content after the cursor does not contain the exact message as a fresh user turn" : reason;
  }
  return { ok: false, verified: false, reason, result };
}

function frontmostWorkspaceId(status: unknown): string | null {
  const fields = record(status);
  if (!fields) return null;
  const direct = stringField(fields, ["frontmostWorkspaceId"]);
  if (direct) return direct;
  const workspaces = Array.isArray(fields.workspaces) ? fields.workspaces : Array.isArray(status) ? status : [];
  for (const entry of workspaces) {
    const workspace = record(entry);
    if (workspace?.frontmost === true) return stringField(workspace, ["workspaceId", "id"]);
  }
  return null;
}

export async function verifiedFocus(send: MachineFn, readStatus: MachineFn | undefined, input: unknown): Promise<FocusReceipt> {
  const args = record(input) ?? {};
  const target = stringField(args, ["workspaceId"]);
  const result = await send(input);
  if (!target) return { ok: false, verified: false, reason: "workspaceId is required to confirm focus", result };
  if (!readStatus) return { ok: false, verified: false, reason: "no cmux workspace status reader is published, so focus cannot be confirmed", result };
  const frontmost = frontmostWorkspaceId(await readStatus({}));
  if (frontmost === null) return { ok: false, verified: false, reason: "frontmost cmux workspace was not reported, so focus is unconfirmed", result };
  if (frontmost !== target) return { ok: false, verified: false, reason: `frontmost cmux workspace is ${frontmost}, not ${target}`, result };
  return { ok: true, verified: true, frontmostWorkspaceId: frontmost, result };
}

export function withVerifiedCmuxDelivery(fns: MachineFns, options: VerificationOptions = {}): MachineFns {
  const readTail = fns.cmux_surface_tail ?? fns.cmux_pi_tail;
  const readStatus = fns.cmux_workspace_list;
  const wrapped: MachineFns = { ...fns };
  for (const [name, fn] of Object.entries(fns)) {
    if (isVerifiedPromptTool(name)) wrapped[name] = (input) => verifiedPrompt(fn, readTail, input, options);
    else if (isFocusTool(name)) wrapped[name] = (input) => verifiedFocus(fn, readStatus, input);
  }
  return wrapped;
}
