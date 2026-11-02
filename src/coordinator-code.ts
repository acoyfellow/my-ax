import { normalizeCode } from "@cloudflare/codemode";
import type { JobRow } from "./jobs";

export function wrapCoordinatorCode(code: string, methodNames: readonly string[]): string {
  const program = normalizeCode(code);
  return `async () => { const { ${methodNames.join(", ")} } = codemode; return await (${program})(); }`;
}

export type CoordinatorJobSummary = Omit<JobRow, "prompt"> & { promptChars: number };

export function summarizeCoordinatorJob(job: JobRow): CoordinatorJobSummary {
  const { prompt, ...rest } = job;
  return { ...rest, promptChars: typeof prompt === "string" ? prompt.length : 0 };
}
