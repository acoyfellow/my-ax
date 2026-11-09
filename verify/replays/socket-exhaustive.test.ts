import assert from "node:assert/strict";
import { test } from "node:test";
import { initialSocketConnection, nextSocketConnection, type SocketConnection, type SocketConnectionEvent } from "../../src/fsm/socket-connection";

const MAX_ATTEMPTS = 3;
const SEARCH_LIMIT = 200;

const EVENTS: readonly SocketConnectionEvent[] = [
  { type: "opened" },
  { type: "dropped", maxAttempts: MAX_ATTEMPTS },
  { type: "retry_due" },
  { type: "force_reconnect" },
  { type: "resume" },
  { type: "close" },
];

const CAN_FIRE: Readonly<Record<SocketConnection["kind"], ReadonlySet<SocketConnectionEvent["type"]>>> = {
  connecting: new Set(["opened", "dropped", "force_reconnect", "resume", "close"]),
  open: new Set(["dropped", "force_reconnect", "resume", "close"]),
  waiting: new Set(["retry_due", "force_reconnect", "resume", "close"]),
  exhausted: new Set(["force_reconnect", "resume", "close"]),
  closed: new Set(["opened", "dropped", "retry_due", "force_reconnect", "resume", "close"]),
};

const key = (state: SocketConnection) => JSON.stringify(state);

type Step = { from: SocketConnection; event: SocketConnectionEvent; to: SocketConnection; effect: string };

function explore(events: (state: SocketConnection) => readonly SocketConnectionEvent[]) {
  const seen = new Map<string, SocketConnection>();
  const parent = new Map<string, { from: string; event: string }>();
  const steps: Step[] = [];
  const queue = [initialSocketConnection()];
  seen.set(key(queue[0]), queue[0]);
  while (queue.length && seen.size < SEARCH_LIMIT) {
    const from = queue.shift()!;
    for (const event of events(from)) {
      const { state: to, effect } = nextSocketConnection(from, event);
      steps.push({ from, event, to, effect });
      if (!seen.has(key(to))) {
        seen.set(key(to), to);
        parent.set(key(to), { from: key(from), event: event.type });
        queue.push(to);
      }
    }
  }
  return { states: [...seen.values()], steps, parent };
}

function pathTo(parent: Map<string, { from: string; event: string }>, target: string): string {
  const path: string[] = [target];
  let at = target;
  while (parent.has(at)) {
    const step = parent.get(at)!;
    path.unshift(`${step.from} --${step.event}-->`);
    at = step.from;
  }
  return path.join("\n  ");
}

function checkRules(result: ReturnType<typeof explore>) {
  const { states, steps, parent } = result;
  for (const state of states) {
    if ("attempt" in state && state.attempt > MAX_ATTEMPTS) assert.fail(`attempts grow past the limit:\n  ${pathTo(parent, key(state))}`);
    if (state.kind === "exhausted") assert.ok(state.attempt >= MAX_ATTEMPTS, `gives up only at the limit: ${key(state)}`);
  }
  for (const { from, event, to, effect } of steps) {
    const where = `${key(from)} --${event.type}--> ${key(to)} (${effect})`;
    if (from.kind === "closed") assert.equal(to.kind, "closed", `closed stays closed: ${where}`);
    if (to.kind === "closed") assert.ok(effect === "shutdown" || effect === "none", `no retry after close: ${where}`);
    if (to.kind === "waiting" && from.kind !== "waiting") assert.equal(effect, "schedule_retry", `waiting always has a retry timer: ${where}`);
    if (event.type === "opened" && from.kind !== "closed") assert.equal(to.kind, "open", `opening always lands open: ${where}`);
  }
  assert.ok(states.length < 20, `a small finite set of states, found ${states.length}`);
}

test("every socket state the browser tab can reach keeps the reconnect rules", () => {
  checkRules(explore((state) => EVENTS.filter((event) => CAN_FIRE[state.kind].has(event.type))));
});

test("FINDING: nextSocketConnection itself lets attempts grow past the limit when a drop arrives after it gave up", () => {
  const unguarded = explore(() => EVENTS);
  assert.throws(() => checkRules(unguarded), /attempts grow past the limit/);
});

test("a successful open resets the attempt count so later drops get the full retry budget", () => {
  let state = initialSocketConnection();
  state = nextSocketConnection(state, { type: "dropped", maxAttempts: MAX_ATTEMPTS }).state;
  state = nextSocketConnection(state, { type: "retry_due" }).state;
  state = nextSocketConnection(state, { type: "opened" }).state;
  const afterDrop = nextSocketConnection(state, { type: "dropped", maxAttempts: MAX_ATTEMPTS }).state;
  assert.deepEqual(afterDrop, { kind: "waiting", attempt: 1 });
});
