# my-ax

A personal AI agent operating environment you self-host on Cloudflare.

It's a chat window backed by a durable agent. The agent can connect to public
MCP servers and program three explicit work providers through one Code Mode
surface: its persistent My AX Workspace, an optional physical machine through
`machinectl`, and optional bounded Cloudbox runs.

You can use it from a phone or install it as a PWA on desktop/iPhone. The
public deployment starts with a small curated model catalog and no private MCP
catalog. Deployment owners configure model routing; users connect their own MCP
servers without managing provider keys in the product UI.

---

## What you can do with it

| Try this | What happens |
|---|---|
| "Pull the wiki page on X, summarize, save it" | Your wiki MCP supplies the page; `workspace.*` stores the result in the persistent My AX Workspace. |
| "Check the repository I have open" | `machine.*` uses the connected physical computer and its current local state. |
| "Reproduce this failure from a clean clone" | `cloudbox.*` creates a bounded remote run and returns execution receipts. |
| "Transform these uploads and build a preview" | `workspace.*` operates on snapshot-backed `/home/user` files and processes. |

Production chat runs on **Cloudflare Think**, with native durable messages,
replay/recovery, reasoning, tools, durable programmatic turns. The agent's
tools run as you, and you can interrupt at any point with **Stop**.

Core integration surfaces worth knowing about:

- **`POST /api/sessions/:id/inject`** — inbound session sync. Enqueue a
  durable Think user-turn out-of-band; open PWAs repaint the turn and
  response live.
- **`GET /api/sessions/:id/entries?after=<cursor>&limit=<n>`** — outbound
  incremental sync.
- **`GET /api/sessions/:id/export?format=json|markdown`** — owner-only full
  transcript download.
- **`notify_owner`** — owner-scoped agent Web Push tool; recurring prompts
  can ask the agent to use it.
- **Jobs** — Settings exposes owner-scoped recurring prompts with Run now,
  pause/resume, and delete; recurrences run through native per-session
  `scheduleEvery()` alarms.
- **Live voice mode** — a direct-routed Voice agent owns the microphone/TTS
  lifecycle and delegates utterances into the canonical Think conversation.
  Workers AI Deepgram Flux STT + Aura TTS; one shared Think transcript.
- **One-off Svelte artifacts** — `create_svelte_artifact` persists a
  self-contained Svelte 5 component for the conversation and renders it
  through an allowlisted sandboxed inline preview with a one-click
  immersive fullscreen mode.
- **Run Receipt v0** — owner-scoped APIs plus a read-only board store
  explicitly appended typed events.
- **Inline browser runs** — `browser_open` starts a Cloudflare Browser Run
  session, records a native rrweb replay, and mounts an embedded playable
  player inline in the Think tool card.
- **Work Code Mode** — `work_search` discovers `workspace.*`, `machine.*`, and
  `cloudbox.*`; `work_code` composes them through one isolated Dynamic Worker.
- **Direct MCP coordinator** — `/api/mcp` provides bounded owner-scoped
  session orchestration for external automation.

---

## Read more

- **[Feature matrix](./feature-matrix.md)** — shipped capabilities in one compact reference.
- **[Architecture](./architecture.md)** — how the pieces fit: Workers, Durable Objects, R2, D1, MCPs.
- **[Patterns](./patterns.md)** — the reusable patterns this app demonstrates.
- **[Deploy](./deploy.md)** — Deploy this to your own Cloudflare account.
- **[Local development](./local-development.md)** — Two local-dev modes.

## Run it locally

```bash
npm ci
npm run dev
# → the local Wrangler URL
```

Local dev needs Docker (or Colima) running for the Sandbox container. The
Access middleware short-circuits to `dev@localhost` on `--env dev`.

For UI-only iteration without the container, comment out the `containers:`
block in `wrangler.jsonc → env.dev`. Tool calls that touch the filesystem
will fail, but everything else renders.

Production deploy is `npm run deploy` from a Wrangler-authenticated
workstation. See [deploy](./deploy.md).
