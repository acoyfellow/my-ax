type Vars = { status: string; runCount: number; alarms: number[]; firing: number[]; pause: string; resume: number };

export const title = "A recurring job and its alarm";

const STATUS_WORDS: Record<string, string> = { active: "Active", paused: "Paused", exhausted: "Out of runs" };

export const state = (v: Vars) => {
  const alarm = v.alarms.length === 0 ? "no alarm" : v.alarms.length === 1 ? "alarm set" : `${v.alarms.length} alarms`;
  const busy = v.pause === "cancelled" ? ", pausing" : v.resume ? ", resuming" : v.firing.length ? ", alarm firing" : "";
  return `${STATUS_WORDS[v.status]}, ${alarm}${busy}`;
};

export const group = (v: Vars) => (v.status === "active" ? "active" : v.status === "paused" ? "paused" : "done");

export const colors = { active: "blue", paused: "tan", done: "teal" };

const STEP_WORDS: Record<string, string | null> = {
  AlarmWakesUp: "the alarm wakes",
  AlarmRuns: "the alarm claims a run",
  PauseCancelsAlarm: "you press pause (alarm cancelled)",
  PauseSaves: "pause is saved",
  ResumeSchedulesAlarm: "you press resume (new alarm set)",
  ResumeSaves: "resume is saved",
  Done: null,
};

export const step = (action: string) => (action in STEP_WORDS ? STEP_WORDS[action] : action);
