export const CHILD_WAIT_DEFAULT_SECONDS = 120;
export const CHILD_WAIT_MAX_SECONDS = 600;
export const CHILD_TASK_MAX_CHARS = 20_000;

export type SpawnRequest = { task: string; name: string };

export function parseSpawnArgs(args: Record<string, unknown>): SpawnRequest {
  const task = typeof args.task === "string" ? args.task.trim() : "";
  if (!task) throw new Error("task is required");
  if (task.length > CHILD_TASK_MAX_CHARS) throw new Error(`task is longer than ${CHILD_TASK_MAX_CHARS} characters`);
  const requested = typeof args.name === "string" ? args.name.replace(/\s+/g, " ").trim() : "";
  const name = (requested || task.replace(/\s+/g, " ")).slice(0, 80);
  return { task, name };
}

export function waitSeconds(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return CHILD_WAIT_DEFAULT_SECONDS;
  return Math.min(Math.max(Math.floor(value), 1), CHILD_WAIT_MAX_SECONDS);
}

export function childTaskMessage(parentId: string, task: string): string {
  return [
    `[task from parent conversation ${parentId}]`,
    task,
    "",
    "When you finish, end your reply with one line that starts with DONE: and says the result in one sentence. That line is sent back to the parent.",
  ].join("\n");
}

export function doneLine(text: string): string | null {
  const lines = text.split("\n").map((each) => each.trim()).filter((each) => each.startsWith("DONE:"));
  return lines.length ? lines[lines.length - 1] : null;
}

export type AssistantReply = { entryId: number; text: string };

export function nextDoneDelivery(replies: readonly AssistantReply[], deliveredThrough: number): { entryId: number; line: string } | null {
  for (const reply of [...replies].sort((a, b) => b.entryId - a.entryId)) {
    if (reply.entryId <= deliveredThrough) return null;
    const line = doneLine(reply.text);
    if (line) return { entryId: reply.entryId, line };
  }
  return null;
}

export function parentMessage(childId: string, childName: string, line: string): string {
  return `[message from child conversation ${childName} (${childId})]\n${line}`;
}

export type WaitOutcome = { done: boolean; answer: string };

export function waitOutcome(childName: string, running: boolean, lastAnswer: string, seconds: number): WaitOutcome {
  if (!running && lastAnswer) return { done: true, answer: lastAnswer };
  if (!running) return { done: true, answer: `${childName} finished with no answer` };
  return { done: false, answer: `${childName} is still working after ${seconds}s; call wait_child again later.` };
}
