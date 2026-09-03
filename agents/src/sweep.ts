export const SWEEP_MAX_ISSUES = 40;
export const SWEEP_MAX_CLOSES = 8;
export const SWEEP_MAX_QUEUES = 8;
export const SWEEP_MAX_ATTEMPTS = 3;
export const SWEEP_LEASE_MS = 15 * 60 * 1000;

const FINGERPRINT_RE = /fingerprint:\s*`([a-f0-9]{16})`/i;
const LOOP_BOARD_RE = /^## loop board\b/m;

export interface SweepIssue {
  number: number;
  title: string;
  body: string;
  author: string;
  state: "open" | "closed";
  comments: string[];
  labels?: string[];
  hasHead?: boolean;
  hasOpenPr?: boolean;
  openPr?: { number: number; files: string[] } | null;
}

export type SweepAction =
  | { action: "keep"; number: number; fingerprint: string }
  | { action: "close-duplicate"; number: number; keep: number; fingerprint: string }
  | { action: "close-placeholder-pr"; number: number; prNumber: number }
  | { action: "queue"; number: number }
  | { action: "needs-human"; number: number; attempts: number };

export function extractFingerprint(body: string): string | null {
  const match = body.match(FINGERPRINT_RE);
  return match?.[1] ?? null;
}

export function hasLoopBoard(comments: string[]): boolean {
  return comments.some((body) => LOOP_BOARD_RE.test(body));
}

export function isBlockedStamp(comments: string[]): boolean {
  return comments.some((body) => LOOP_BOARD_RE.test(body) && /\bstage: blocked-stamp\b/.test(body));
}

export function isFactoryOnlyChange(files: string[]): boolean {
  return files.length > 0 && files.every((file) => file.startsWith(".factory/") || file.startsWith("src/factory/"));
}

export function loopBoardAttempts(comments: string[]): number {
  return comments.filter((body) => LOOP_BOARD_RE.test(body)).length;
}

export function sweepLeaseId(issueNumber: number, scheduledTime: number): string {
  const bucket = Math.floor(scheduledTime / SWEEP_LEASE_MS);
  return `sweep-${bucket}-${issueNumber}`;
}

export function planSweep(issues: SweepIssue[]): SweepAction[] {
  const open = issues.filter((issue) => issue.state === "open").slice(0, SWEEP_MAX_ISSUES);
  const byFingerprint = new Map<string, SweepIssue[]>();
  const actions: SweepAction[] = [];
  let closes = 0;
  let queues = 0;

  for (const issue of open) {
    const fingerprint = extractFingerprint(issue.body);
    if (!fingerprint) continue;
    const group = byFingerprint.get(fingerprint) ?? [];
    group.push(issue);
    byFingerprint.set(fingerprint, group);
  }

  for (const [fingerprint, group] of byFingerprint) {
    const keep = [...group].sort((a, b) => a.number - b.number)[0];
    actions.push({ action: "keep", number: keep.number, fingerprint });
    for (const issue of group) {
      if (issue.number === keep.number) continue;
      if (closes >= SWEEP_MAX_CLOSES) break;
      actions.push({ action: "close-duplicate", number: issue.number, keep: keep.number, fingerprint });
      closes += 1;
    }
  }

  const closing = new Set(actions.filter((row) => row.action === "close-duplicate").map((row) => row.number));
  for (const issue of open) {
    if (closing.has(issue.number)) continue;
    if (issue.openPr && isFactoryOnlyChange(issue.openPr.files)) {
      actions.push({ action: "close-placeholder-pr", number: issue.number, prNumber: issue.openPr.number });
      continue;
    }
    if (issue.hasOpenPr || issue.openPr) continue;
    if ((issue.labels ?? []).includes("triage:needs-human")) continue;
    const attempts = loopBoardAttempts(issue.comments);
    const optedIn = (issue.labels ?? []).includes("triage:draft");
    const retryable = optedIn || isBlockedStamp(issue.comments) || !hasLoopBoard(issue.comments);
    if (!retryable) continue;
    if (attempts >= SWEEP_MAX_ATTEMPTS) {
      actions.push({ action: "needs-human", number: issue.number, attempts });
      continue;
    }
    if (queues >= SWEEP_MAX_QUEUES) continue;
    actions.push({ action: "queue", number: issue.number });
    queues += 1;
  }

  return actions;
}

export function formatPlaceholderPrClose(issueNumber: number): string {
  return [
    "## factory cleanup",
    `issue: #${issueNumber}`,
    "reason: the pull request contains only factory receipt files and no product change",
    "result: closed without merge or approval",
    "next: triage:needs-human",
  ].join("\n");
}

export function formatRetryExhausted(attempts: number): string {
  return [
    "## loop board",
    "stage: retry-exhausted",
    `attempts: ${attempts}`,
    "next: triage:needs-human",
    "Worker stopped automatic retries. Worker never merges and never approves.",
  ].join("\n");
}

export function formatDuplicateClose(keep: number, fingerprint: string): string {
  return [
    "Same fingerprint as a prior open issue.",
    `fingerprint: \`${fingerprint}\``,
    `keep: #${keep}`,
    "Closing this as a duplicate.",
  ].join("\n");
}

