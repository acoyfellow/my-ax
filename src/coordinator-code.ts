import type { JobRow } from "./jobs";

export function wrapCoordinatorCode(code: string, methodNames: readonly string[]): string {
  const trimmed = code.trim();
  if (!trimmed || /\bcodemode\./.test(trimmed)) return trimmed;
  return `async () => { const { ${methodNames.join(", ")} } = codemode; const __fn = ${trimmed}; return typeof __fn === "function" ? await __fn() : __fn; }`;
}

export type CoordinatorJobSummary = Omit<JobRow, "prompt"> & { promptChars: number };

export function summarizeCoordinatorJob(job: JobRow): CoordinatorJobSummary {
  const { prompt, ...rest } = job;
  return { ...rest, promptChars: typeof prompt === "string" ? prompt.length : 0 };
}
