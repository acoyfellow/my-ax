export const MORNING_PICK_JOB_NAME = "Morning pick";
export const MORNING_PICK_QUESTION_PREFIX = "Morning pick:";
export const MORNING_PICK_SHIP = "Ship it";
export const MORNING_PICK_DECLINE = "Not this";
export const MORNING_PICK_WRONG = "Why this?";
export const MORNING_PICK_OPTIONS = [MORNING_PICK_SHIP, MORNING_PICK_DECLINE, MORNING_PICK_WRONG] as const;
export const MORNING_PICK_CADENCE_SECS = 60 * 60 * 24;

export const MORNING_PICK_PROMPT = [
  "Morning pick. The owner wrote no prompt. Choose the single most valuable task you can finish without them, finish it, and ask one question.",
  "",
  "1. Read ambient context only. Use what is reachable: `gh` for the owner's open pull requests, review requests, failing checks and assigned issues; my_ax_check_in for attention items, failed runs and jobs; search_conversations for yesterday's unfinished threads; the workspace git state.",
  "2. List up to five candidates. For each, note the source, the value, and whether you can finish it alone in under thirty minutes.",
  "3. Pick exactly one that you can finish alone. Prefer red CI on the owner's pull requests, then review requests, then small assigned issues, then loose ends from yesterday.",
  "4. Do the work on a new branch or as a draft. Never merge, deploy, send email, close issues or post comments as the owner. Push the branch and open a draft pull request when the task is code.",
  `5. Call ask_user exactly once. The question must start with "${MORNING_PICK_QUESTION_PREFIX}" and say in two sentences what you picked, why, and where the result is (link the draft pull request or file). Options, in order: ${MORNING_PICK_OPTIONS.map((option) => `"${option}"`).join(", ")}.`,
  "6. If nothing qualifies, do not ask. Reply with one line that says why, and stop.",
  "",
  `When the owner answers "${MORNING_PICK_SHIP}", mark the draft ready and merge it if checks are green and you have permission; otherwise tell them the one step left. When they answer "${MORNING_PICK_DECLINE}", close the draft and stop. When they answer "${MORNING_PICK_WRONG}", list the candidates you considered and why you ranked the pick first, and do not ship.`,
].join("\n");

export type MorningPickAnswer = "shipped" | "declined" | "questioned" | "pending";

export interface MorningPickDecisionRow {
  id: string;
  status: string;
  created_at: string;
  choice: string | null;
}

export interface MorningPickStats {
  picks: number;
  shipped: number;
  declined: number;
  questioned: number;
  pending: number;
  shipRate: number | null;
  questionRate: number | null;
}

export function morningPickAnswer(row: Pick<MorningPickDecisionRow, "status" | "choice">): MorningPickAnswer {
  if (row.choice === MORNING_PICK_SHIP) return "shipped";
  if (row.choice === MORNING_PICK_DECLINE) return "declined";
  if (row.choice === MORNING_PICK_WRONG) return "questioned";
  return "pending";
}

export function morningPickStats(rows: readonly Pick<MorningPickDecisionRow, "status" | "choice">[]): MorningPickStats {
  const counts = { shipped: 0, declined: 0, questioned: 0, pending: 0 };
  for (const row of rows) counts[morningPickAnswer(row)] += 1;
  const answered = counts.shipped + counts.declined + counts.questioned;
  return {
    picks: rows.length,
    ...counts,
    shipRate: answered === 0 ? null : counts.shipped / answered,
    questionRate: answered === 0 ? null : counts.questioned / answered,
  };
}
