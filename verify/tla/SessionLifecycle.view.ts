type Vars = { status: string; turn: string };

const STATUS_WORDS: Record<string, string> = {
  active: "Idle",
  running: "Working",
  error: "Last turn failed",
  interrupted: "Interrupted",
  archived: "Archived",
};

export const title = "A conversation's status in the sidebar";

export const state = (v: Vars) => `${STATUS_WORDS[v.status]}${v.turn === "working" ? " · agent still working" : ""}`;

export const group = (v: Vars) => (v.turn === "working" ? "working" : v.status === "archived" ? "archived" : "idle");

export const colors = { working: "blue", idle: "teal", archived: "tan" };

const STEP_WORDS: Record<string, string> = {
  YouSendMessage: "you send a message",
  TurnFinishes: "the reply finishes",
  TurnFails: "the reply fails",
  YouStopTurn: "you press stop",
  WatchdogEndsStuckTurn: "the watchdog ends a stuck reply",
  RecoveryGivesUp: "recovery gives up",
  ScannerFlagsQuietSession: "the dead-session scan flags it",
  YouArchive: "you archive it",
  YouUnarchive: "you unarchive it",
};

export const step = (action: string) => STEP_WORDS[action] ?? action;
