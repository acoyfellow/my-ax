# My Agent Experience

My AX stores each conversation in a Cloudflare Think agent. A submitted turn can continue after the PWA disconnects, and D1 keeps a separate transcript projection for search and export. Computer work enters through `work_search` and `work_code`, which route calls to a snapshot-backed workspace, an outbound-connected machine, or a Cloudbox run.

```text
phone or desktop
       │
       ▼
  Think conversation
       │
       ▼
work_search · work_code
       │
       ├─ workspace.*  My AX Workspace
       ├─ machine.*    My Machine
       └─ cloudbox.*   Cloudbox
```

The deployment, stored data, OAuth grants, model routes, and connected tools stay in the operator's Cloudflare account.

## A Deployed Run

[![A deployed My AX conversation showing one Work Code Mode execution across My AX Workspace, My Machine, and Cloudbox](./docs/media/my-ax-kitchen-sink.png)](./docs/media/my-ax-kitchen-sink.mp4)

The linked MP4 is an accelerated Unsurf trace from the deployed app. One `work_code` call wrote and read `/home/user`, ran `printf MACHINE_OK` through the connected machine, then created a Cloudbox run and read back `CLOUDBOX_OK`. The original interaction took about six seconds; the checked-in video is 5.2 seconds.

## Current Surface

| Capability | Mechanism | Boundary |
|---|---|---|
| Conversations | Cloudflare Think owns live messages, streaming, recovery, reasoning, and compaction. D1 stores a transcript projection. | Provider failures can still end a turn. D1 is not the live inference state. |
| My AX Workspace | Cloudflare Sandbox keeps `/home/user`; turn-end snapshots are stored in R2. | Writes after the last successful snapshot can be lost if the container disappears. |
| My Machine | `machinectl` opens an outbound connection and publishes its current method catalog. | Optional and terminal-equivalent. It is unavailable when the companion is offline. |
| Cloudbox | A configured Cloudbox deployment clones a public repository into a live run and returns runner receipts. | Optional. The current adapter supports create, read, write, and exec; it does not publish changes. |
| Connected MCPs | Users add public HTTPS MCP servers and complete the server's OAuth flow. | Attribution depends on the upstream MCP and its OAuth implementation. |
| Voice and push | Voice delegates into the same Think conversation. Web Push carries completion and decision attention. | Push needs VAPID configuration and browser support; delivery is not guaranteed. |
| Browser and artifacts | Browser Run records public-page sessions; Svelte artifacts render in sandboxed same-origin previews. | Browser Run does not inherit the user's logged-in local browser state. |

## Work Code Mode

`work_search` returns available methods, their location, and live Machinectl input schemas. `work_code` runs one async JavaScript function in an official `@cloudflare/codemode` Dynamic Worker.

```js
async () => {
  await workspace.write({
    path: '/home/user/notes.md',
    content: 'Stored in the My AX Workspace',
  });

  const local = await machine.shell({
    command: 'git status --short --branch',
    cwd: '/path/to/current/checkout',
  });

  const run = await cloudbox.run_create({
    repo: 'https://github.com/you/project',
  });

  return { local, runId: run.runId };
}
```

| Namespace | Use |
|---|---|
| `workspace.*` | Persistent files, transforms, processes, and previews near the conversation. |
| `machine.*` | Current local checkouts, desktop state, authentication, and cmux/Pi sessions exposed by `machinectl`. |
| `cloudbox.*` | Public-repository clones and bounded remote commands with runner receipts. |

The Dynamic Worker has no ambient network access and receives no raw credentials, environment variables, or service bindings. Injected methods can still perform network or filesystem effects through their host implementations. `machine.*` therefore carries the connected user's local authority. `cloudbox.*` currently has no push, merge, or publication method.

## Bootstrap a Deployment

Requirements:

- Node.js 22 and npm 11
- Docker, Colima, or WSL2
- Python 3, Bash, and OpenSSL
- Wrangler authentication
- Cloudflare Workers, Containers, D1, KV, R2, Workers AI, Browser, and Worker Loader access

```bash
git clone https://github.com/acoyfellow/my-ax
cd my-ax
npm ci

npx wrangler login
bash scripts/setup.sh
```

The script creates or resolves D1, KV, and R2 resources, generates the bridge and encryption secrets, applies migrations, and deploys the Worker. That first production deployment rejects app requests until `CF_ACCESS_ISS` and `CF_ACCESS_AUD` identify a Cloudflare Access application.

Workspace snapshots need bucket-scoped R2 S3 credentials. Push needs a VAPID key pair. The exact steps and failure modes are in [Deploying My AX](./docs/deploy.md).

## Connect an MCP Server

Open **Settings → Connectors → Add**, enter a public HTTPS MCP endpoint, and complete its authorization flow. My AX discovers OAuth metadata, stores tokens encrypted per user, refreshes them server-side, and rejects embedded credentials plus private, loopback, and metadata destinations.

A deployment may expose an exact read/query subset through MCP Code Mode:

```json
{
  "version": 1,
  "enabled": true,
  "connectors": {
    "github": {
      "expose": ["search_issues", "list_pull_requests", "get_file_contents"]
    }
  }
}
```

Absent, invalid, new, and unlisted methods are excluded. Native MCP tools remain visible for simple calls and operations that should not be hidden inside generated code.

## Optional Work Providers

### My Machine

`machinectl` is a separate companion: <https://github.com/acoyfellow/machinectl>. It opens an outbound connection; My AX does not expose an inbound laptop port. The live catalog determines which `machine.*` methods exist.

### Cloudbox

Set `CLOUDBOX_URL` and the `CLOUDBOX_INTERNAL_TOKEN` deployment secret. The same token must be configured on Cloudbox. Without both values, `cloudbox.*` is reported as unavailable.

## Runtime Map

```text
PWA
 │  chat · voice · push · artifacts
 ▼
Worker + Think agent
 ├─ Durable Objects  user root, conversations, OAuth, machine relay
 ├─ D1               session index, transcript projection, jobs, attention
 ├─ R2               uploads, artifacts, workspace backups
 ├─ Sandbox          My AX Workspace
 ├─ Worker Loader    Work Code Mode and optional MCP Code Mode
 ├─ Browser Run      public-page screenshots and rrweb replay
 ├─ machinectl       optional physical-machine provider
 ├─ Cloudbox         optional bounded-run provider
 └─ MCP              user-authorized external tools
```

[Architecture](./docs/architecture.md) documents the request path, storage ownership, bindings, and identity flow.

## Development

```bash
npm ci
npm run check
npm run dev
```

`npm run check` rebuilds generated assets, typechecks, and runs the local test suite. Container and Access-backed development modes are documented in [Local Development](./docs/local-development.md).

## Source Map

| Path | Responsibility |
|---|---|
| `src/agent.ts` | Think runtime, tool assembly, and turn lifecycle. |
| `src/work-tools.ts` | `work_search`, `work_code`, provider dispatch, and per-call metadata. |
| `src/think-workspace.ts` | Think workspace operations mapped to `/home/user`. |
| `src/routes/machinectl.ts` | Physical-machine relay and live capability adapter. |
| `src/cloudbox-tools.ts` | Cloudbox live-run adapter. |
| `src/connectors.ts`, `src/oauth-store.ts` | MCP registration and encrypted OAuth storage. |
| `proof/svelte/` | Svelte PWA and trusted result renderers. |
| `scripts/setup.sh` | Resource bootstrap and first deployment. |

## Documentation

- [Deploying My AX](./docs/deploy.md)
- [Local Development](./docs/local-development.md)
- [Architecture](./docs/architecture.md)
- [Feature Status and Limits](./docs/feature-matrix.md)
- [Implementation Patterns](./docs/patterns.md)
- [Deployment Proof](./proof/README.md)
- [Security Policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

## License

MIT
