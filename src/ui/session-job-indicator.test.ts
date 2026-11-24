import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { recurringJobCount, recurringJobText } from "./session-job-indicator";

test("only a positive active job count shows the indicator", () => {
  assert.equal(recurringJobCount(2), 2);
  assert.equal(recurringJobCount("1"), 1);
  assert.equal(recurringJobCount(0), 0);
  assert.equal(recurringJobCount(null), 0);
  assert.equal(recurringJobCount(undefined), 0);
  assert.equal(recurringJobCount("x"), 0);
});

test("the indicator says how many jobs run in the conversation", () => {
  assert.equal(recurringJobText(1), "1 recurring job runs in this conversation");
  assert.equal(recurringJobText(3), "3 recurring jobs run in this conversation");
});

test("the session list counts only active jobs of the same owner", () => {
  const routes = readFileSync(new URL("../routes/sessions.ts", import.meta.url), "utf8");
  const counted = routes.match(/\(SELECT COUNT\(\*\) FROM jobs WHERE jobs\.session_id = sessions\.id AND jobs\.owner_email = sessions\.owner_email AND jobs\.status = 'active'\) AS active_jobs/g) ?? [];
  assert.equal(counted.length, 3);
});

test("each sidebar row renders the indicator from active_jobs", () => {
  const sidebar = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");
  assert.match(sidebar, /\{#if hasRecurringJob\(row\)\}[\s\S]{0,200}data-testid="session-job-indicator"/);
  const status = sidebar.slice(sidebar.indexOf('<span class="session-row__status"'), sidebar.indexOf('<div\n            class="session-row__main"'));
  assert.match(status, /<SessionSignalDot \{signal\} \/>[\s\S]*data-testid="session-job-indicator"/, "the clock sits inside the status group, right after the running spinner");
  const rowStart = sidebar.indexOf('<span class="session-row__status"');
  const main = sidebar.slice(sidebar.indexOf('class="session-row__main"', rowStart), sidebar.indexOf("{@render rowMenu(row, title", rowStart));
  assert.doesNotMatch(main, /session-job-indicator/, "the clock is not a flex child of the title row, so it cannot wrap or push the time");
});
