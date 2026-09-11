# Factory (a recurring job, not a product)

There is no Factory tab and no factory verb. A factory is **one durable My AX conversation** plus a **recurring job** that pings that same thread on a short cadence. It is not a new session every run.

Checkpoint to eject to: git SHA `4f0be045daee26d6ba185327c7292d738fba7617` (sidecar agents Worker with keyword-safe sweep). The scheduled sidecar sweep is **off**. Do not turn that cron back on unless you eject.

## Shape (like a terraloop)

| Piece | What it is |
| --- | --- |
| Cockpit | One session. Title it `factory`. `thread_mode=same_session`. |
| Heartbeat | Recurring job. Cadence is the owner's choice. `max_runs` unset. Each ping is "keep going", not a new chat. |
| Fan-out | When an open issue has no conversation titled `Issue #<n>: …`, open that chat (cap 3 new per ping). |
| Place | **My AX Workspace (Sandbox) only.** Never My Machine. Never cmux. Never the live page. |
| Stop | Delete or pause the job. Issue sessions stay. |

A `new_session_per_run` job with `max_runs: 1` is **not** a factory. It dies after one turn and has no heartbeat.

## Hard place rule

The factory does **not** use the owner's laptop.

Allowed: Sandbox `gh`, Sandbox files, My AX session tools (`listSessions`, `inject`, `notify_owner`).

Forbidden: `machine.*`, cmux, page verbs, steering another Pi on the desk, screenshots of local terminals.

If a tool would run on My Machine, skip it and `notify_owner` instead.

## What you already have

- Settings → Recurring jobs
- Thread mode **Same thread** (`same_session`)
- Sandbox `gh` for the repo this deploy uses
- `notify_owner` when blocked

## One-time setup

1. Open (or keep) one chat named `factory`.
2. Settings → Recurring jobs → add a job **on that session**.
3. Name: `factory`
4. Cadence: pick a human interval (minutes, not a 60s storm).
5. Thread: **Same thread**.
6. Max runs: empty (unlimited until you pause/delete).
7. Prompt (copy):

```
You are the factory cockpit. Stay in this session. Do not create, pause, or delete recurring jobs.

Place: My AX Workspace (Sandbox) only. Never My Machine. Never cmux. Never page tools. Never steer a local Pi.

Each ping: work one cycle, then stop until the next ping.

1. Heartbeat: notify_owner only if you are blocked or a PR needs a human. Do not ping every cycle.
2. List open issues with Sandbox gh on this repo (skip needs-human / already killed with evidence). Prefer actionable product bugs over meta tickets.
3. Fan-out: for each issue that does not already have a conversation titled exactly
   Issue #<number>: <title>
   open that conversation. Cap: 3 new per ping.
4. First message in each Issue #<n>: session is the contract:
   - Goal: smallest product fix plus a focused test, or kill with proof
   - Gate: a PR on bot/issue-<n> with a human-readable review, or this session contains killed: and evidence
   - Proof: the test or command that would fail before the fix
   - Never merge. Never approve. Ping the owner with notify_owner if blocked.
   - That issue session also stays in Sandbox. It must not use My Machine.
5. If Issue #<n>: sessions already exist, inject a one-line continue: "heartbeat: still open / blocked / PR ready" — do not restart the contract.
6. Do not comment on GitHub issues except by opening or updating a pull request.
7. Never merge. Never approve.
```

## Title rule

`Issue #231: delegated agent cannot see parent workspace`

The cockpit skips titles that already exist. GitHub is the forge (branches, PRs). My AX Sandbox is the control room. The laptop is out of bounds.

## Stop

Pause or delete the `factory` job. Issue sessions stay as normal chats. Sidecar factory stays off unless you eject to `4f0be04` and restore cron yourself.
