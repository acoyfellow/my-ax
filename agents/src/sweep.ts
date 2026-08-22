export const SWEEP_MAX_ISSUES = 40;
export const SWEEP_MAX_CLOSES = 8;
export const SWEEP_MAX_QUEUES = 8;

const FINGERPRINT_RE = /fingerprint:\s*`([a-f0-9]{16})`/i;
const LOOP_BOARD_RE = /^## loop board\b/m;

export interface SweepIssue {
  number: number;
  title: string;
  body: string;
  author: string;
  state: "open" | "closed";
  comments: string[];
  hasHead?: boolean;
  hasOpenPr?: boolean;
}

export type SweepAction =
  | { action: "keep"; number: number; fingerprint: string }
  | { action: "close-duplicate"; number: number; keep: number; fingerprint: string }
  | { action: "queue"; number: number };

export function extractFingerprint(body: string): string | null {
  const match = body.match(FINGERPRINT_RE);
  return match?.[1] ?? null;
}

export function hasLoopBoard(comments: string[]): boolean {
  return comments.some((body) => LOOP_BOARD_RE.test(body));
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
    if (issue.hasOpenPr) continue;
    if (hasLoopBoard(issue.comments)) continue;
    if (queues >= SWEEP_MAX_QUEUES) continue;
    actions.push({ action: "queue", number: issue.number });
    queues += 1;
  }

  return actions;
}

export function formatDuplicateClose(keep: number, fingerprint: string): string {
  return [
    "Same fingerprint as a prior open issue.",
    `fingerprint: \`${fingerprint}\``,
    `keep: #${keep}`,
    "Closing this as a duplicate.",
  ].join("\n");
}

