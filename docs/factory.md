# Factory (a recurring job, not a product)

There is no Factory tab and no factory verb. A factory is a **recurring job** that watches GitHub issues and opens **one conversation per issue**.

Checkpoint to eject to: git SHA `4f0be045daee26d6ba185327c7292d738fba7617` (sidecar agents Worker with keyword-safe sweep). The scheduled sidecar sweep is **off**. Do not turn that cron back on unless you eject.

## What you already have

- Settings → Recurring jobs
- Thread mode **New thread each run** (`new_session_per_run`)
- Sandbox `gh` for the repo this deploy uses
- Push when a job needs you

## One-time setup

1. Settings → Recurring jobs → add a job.
2. Name: `issue sweep`
3. Cadence: 15 minutes (or slower).
4. Thread: **New thread each run** for the sweep itself, **or** keep one sweep session and let the prompt open chats — if the job can only mint *its* run session, use that session as the sweep cockpit and start issue threads from there with the same title rule.
5. Prompt (copy):

```
You are the issue sweep. Do not comment on GitHub issues except by opening or updating a pull request.

List open issues on this repo with label triage:draft that are not already a conversation titled exactly:
Issue #<number>: <title>

Cap: 3 new conversations per run.

For each new issue, start a conversation with that title. First message is the contract:
- Goal: smallest product fix plus a focused test, or kill with proof
- Gate: a PR on bot/issue-<n> with a human-readable review, or this session contains killed: and evidence
- Proof: the test or command that would fail before the fix
- Never merge. Never approve. Ping the owner with notify_owner if blocked.

Skip issues that already have that session title.
```

## Title rule

`Issue #231: delegated agent cannot see parent workspace`

The sweep skips titles that already exist. GitHub is the forge (branches, PRs). My AX is the control room.

## Stop

Delete the recurring job. Issue sessions stay as normal chats. Sidecar factory stays off unless you eject to `4f0be04` and restore cron yourself.
