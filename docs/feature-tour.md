# Feature Tour

Each section shows one capability, the tool that runs it, and a real result from a
production run or a passing test. The receipt is the point: the agent produces an
artifact you can read, not a claim you have to trust.

The receipts below are real run output with the shape preserved. Identifying
fields (owner email, machine name, region, session and surface ids, project
names) are redacted or replaced with placeholders. Model output varies between
runs; the mechanism and the receipt shape do not.

## Spawn A Bounded Cloud Run

The agent hands a whole task to a cloud machine and waits for a signed result.
`terrarium.spawn` blocks until the run finishes; `terrarium.spawn_background`
returns immediately with a run id the agent can poll.

Prompt (the tool was not named; the agent chose it):

```text
I need proof, not just a claim: verify that python3 -c "print(6*7)" outputs 42,
in an isolated environment, and give me a verifiable receipt of the run.
```

The agent chose `terrarium.spawn_background`, got a contract, then polled
`terrarium.status` until the run finished. Terminal receipt:

```json
{
  "runId": "ter_mrvh0clm_f7e03656250d",
  "status": "done",
  "exitCode": 0,
  "taskContractStatus": "verified",
  "taskResultSummary": "stdout: 42",
  "reason": "verified-receipt",
  "contract": {
    "taskFingerprint": "af6a39480392ef7c5cd515b9",
    "nonce": "1ab133a5-d353-43e7-9b9b-3a410634267b"
  }
}
```

The run happened on Terrarium's own container, not the laptop and not the worker.
The `runId`, `taskFingerprint`, and `nonce` are what make the result auditable
after the fact.

## Drive Your Own Live UI

While an owner chat tab is open, `page.*` verbs reach into that browser session
over the chat WebSocket. The agent can read the session list, the health block,
and the transcript tail, and it can switch sessions or open Settings.

A `page.readHealth()` call returned the live session, including the deployed
worker version:

```json
{
  "identity": "owner@example.com",
  "region": "<redacted>",
  "container": { "instanceType": "standard-4", "vcpus": 4, "memoryGiB": 12 },
  "worker": { "versionId": "<version-id>" }
}
```

Each verb errors `page_unavailable` when no live tab is connected. The connector
needs no configuration; it is present whenever a chat tab is open.

## Build A Live Instrument

`create_svelte_artifact` compiles a self-contained Svelte 5 component and renders
it in a sandboxed iframe. The artifact can register its own tools on mount. The
agent discovers them with `page.listArtifactTools()` and calls them with
`page.invokeArtifactTool()`, so it can steer the artifact after it is built.

The agent built a "Live Cockpit" artifact, then drove it on the next turn:

```json
{
  "tools": [
    { "artifactId": "9684a438-...", "name": "setStatus" },
    { "artifactId": "9684a438-...", "name": "readState" }
  ],
  "set": { "status": "ALL SYSTEMS GO" },
  "read": { "status": "ALL SYSTEMS GO" }
}
```

`setStatus` mutated the live iframe; `readState` confirmed the change stuck. The
tools are bound to the source window, capped per artifact, and validated against
the schema the artifact registered. A freshly created artifact's tools become
discoverable on the next turn, after the iframe has mounted and registered.

## Run A Command On A Machine You Connect

A [machinectl](https://github.com/acoyfellow/machinectl) companion you install
adds `machine.*` methods that run as the companion's OS account. The companion
connects outbound only and opens no inbound port. The agent gets the command
output. You can read the exact command it ran.

The live connector status for a connected machine:

```json
{ "connected": true, "machineName": "<your-machine>", "tools": [{ "name": "shell", ... }] }
```

The companion is the highest-authority path and has the same power as a terminal.
Run it under a dedicated least-privilege OS account. See the security posture in
SECURITY.md before you connect a machine.

## Steer A Long-Lived Terminal

`machine.*` also exposes cmux control: read a terminal's tail, prompt a paired
Pi session, and steer or abort it. Resolution targets the current live session,
not a stale historical record.

A surface with several historical Pi sessions plus one live session resolves to
the live one:

```json
{
  "surfaceId": "<surface-id>",
  "sessionId": "<session-id>",
  "content": "agent terminal tail — live session output"
}
```

An explicit `sessionId` that points only at a dead session fails closed rather
than steering the wrong process:

```json
{ "error": "The recorded Pi process is no longer live. Refresh or resume it locally first." }
```

## Schedule Recurring Work

Native per-session alarms run saved prompts on a cadence from 60 seconds to 30
days. One owner-scoped job service backs the HTTP routes, the agent tools, Code
Mode, and MCP. D1 holds job state and durable history; each run writes a receipt.

Limits: at most 10 active jobs per owner, names up to 200 characters, prompts up
to 4,000. The D1 view and the native scheduler can disagree, and there is no
automatic repair; pause, delete, and recreate a drifted job.

## Reuse A Proven Procedure

When the agent writes a `work_code` function that is broadly reusable, it marks
it with one comment: `// reusable-tool: <name>`. You approve it in Settings, or
opt into automatic enablement. Reuse runs the exact saved code, so the procedure
does not drift between runs. Each run records a receipt that appears in Check-in.

Reusable tools are the agent's operational memory of how to do a task, kept as
code you approved rather than a prompt it re-derives.

## Return To A Check-In

You do not watch the agent. `GET /api/check-in` and MCP `my_ax_check_in` compose
one response from Attention, jobs, and run receipts: what needs you, what is
running, what finished or failed, and a suggested next step. The authenticated
shell renders those as owner pages at `/attention`, `/runs`, and `/jobs`, and
keeps the raw API receipt href on each link.

A failed scheduled run, an exhausted recovery attempt, or a question from the
agent lands in Attention. Web Push delivers it when you are away. The item stays
if push fails, so a dropped notification does not lose the work.

## What This Tour Does Not Prove

Every receipt above is one run of one task. It shows the mechanism works on that
path. It does not measure latency, cost, or reliability across many runs, and it
does not replace the [deployment proof](../proof/README.md), which checks Access,
containers, models, voice, push, and workspace restoration against a deployed
Worker.
