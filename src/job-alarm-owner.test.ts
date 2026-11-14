import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const jobs = readFileSync(new URL("./jobs.ts", import.meta.url), "utf8");
const owner = readFileSync(new URL("./user-agent.ts", import.meta.url), "utf8");

test("recurring job alarms live on the owner's UserAgent, not on a think session", () => {
  assert.match(jobs, /owner\.scheduleJobAlarm\(/);
  assert.match(jobs, /owner\.cancelJobAlarm\(/);
  const scheduling = jobs.slice(jobs.indexOf("export async function scheduleJob("), jobs.indexOf("export async function moveJobAlarmsToOwner("));
  assert.doesNotMatch(scheduling, /getSessionAgent|scheduleRecurringPrompt/);
});

test("the owner alarm runs the job through the engine-aware runJobNow", () => {
  assert.match(owner, /scheduleEvery\(payload\.cadenceSecs, "runJobAlarm"/);
  assert.match(owner, /await runJobNow\(this\.env, row\)/);
});
