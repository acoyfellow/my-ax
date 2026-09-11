export const SCHEDULED_JOB_RUN_PREFIX = "You are executing one scheduled run of an existing recurring job. Do not create, update, resume, pause, delete, or schedule recurring jobs from this run unless the owner explicitly asked this run to modify job configuration. Do the requested check/work once, leave truthful receipts/notifications required by the prompt, then stop.";

export function scheduledJobRunPrompt(prompt: string): string {
  return `${SCHEDULED_JOB_RUN_PREFIX}\n\n${prompt}`;
}

export function isScheduledJobRunMessage(content: string): boolean {
  return content.startsWith(SCHEDULED_JOB_RUN_PREFIX);
}
