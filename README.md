# My Agent Experience

My AX is an experimental, single-operator personal agent runtime deployed in the operator's Cloudflare account. Each conversation has durable Think state and can use connected capabilities, run recurring work, delegate bounded analysis, request decisions, and retain supported outputs across authenticated devices.

The operator controls the deployment configuration and Cloudflare resources it uses. Calls to model providers, MCP servers, Cloudbox, and a connected machine execute outside My AX's storage boundary. Each receives the data and capabilities explicitly sent to it and may retain data under its own configuration or policy.

## What It Does

- **Check-in** — authenticated HTTP and MCP surfaces summarize what needs the owner, what is running, what recently completed, and the next steer from existing Attention, jobs, and run receipts. The shell maps raw API steers to rendered owner destinations for `/attention`, `/runs`, and `/jobs`.
- **Durable conversations** — Think is authoritative for conversation execution and retained message state. D1 contains a derived transcript index for UI, search, and export. In-flight work may still be interrupted by provider or runtime failure.
- **Connected capabilities** — the model and generated programs receive callable tools instead of OAuth tokens or deployment secrets. Trusted server-side adapters hold credentials and retain their configured authority.
- **Execution environments** — use the container-backed owner workspace plus optional Machine, Cloudbox, and public-page Browser capabilities.
- **Recurring jobs** — authenticated UI routes and agent tools share one owner-scoped service to create, update, pause, resume, run, inspect, and delete scheduled prompts.
- **Bounded delegation** — a parent can invoke up to two concurrent child agents for model-only analysis, then synthesize their retained results.
- **Attention and outputs** — decisions and supported output records remain associated with their owner and source conversation; object bytes live in R2 where applicable.
- **Saved recipe learning loop** — owner-approved `work_code` recipes can be listed, promoted, and run again. Reuse replaces regenerating saved code with exact saved code. Real Workers AI Kimi K2.7 measurements on 2026-06-29 showed reuse cut output tokens about 72% for the repeated procedure, and a fresh-session overhead attribution run on 2026-06-30 showed the same structural effect for one turn: 394 output tokens deriving from scratch versus 157 via `recipe.run`. That is a correctness and determinism win, not a guaranteed total-token win: invoking a recipe adds input/tool overhead, so total tokens can rise for small procedures. Per-cycle model usage is instrumented and live in production through `cycle_costs` and the owner-scoped `/api/cost-series` endpoint; see `proof/recipe-dogfood-learning-curve-2026-06-29-reuse.json` and `proof/experiments/overhead-attribution-2026-06-30.json`.

```text
Owner through Cloudflare Access
              │
              ▼
       MyAgent · Think
 authoritative conversation
   execution and history
              │
    ┌─────────┼───────────┬──────────────┐
    ▼         ▼           ▼              ▼
 tools/MCP  recurring   delegation    decisions/outputs
              jobs      (max 2)       Attention + push
    │
    ├─ workspace.*  My AX Workspace
    ├─ machine.*    My Machine
    ├─ cloudbox.*   Cloudbox
    └─ browser      public-page Browser Run
```

### Who owns what

| Layer | Responsibility |
|---|---|
| **Agents SDK** | Durable identity, conversation facets, WebSockets, schedules, MCP, RPC, and child runs. |
| **Think** | Model/tool turns, message history, recovery, conversation memory, and compaction. |
| **My AX** | Single-operator authorization, UI, product policy, jobs, Attention, outputs, and work providers. |

Think is authoritative for conversation execution and history. D1 stores application records and derived indexes; R2 stores object bytes and workspace snapshots. Snapshots are not continuous backups.

Code Mode has no direct database, secret, or network bindings. Its allowlisted server-side callbacks retain their normal authority.

### Check-in as the owner-return dashboard

`GET /api/check-in` and MCP `my_ax_check_in` remain the stable machine-readable receipts. They return raw API steers such as `/api/attention`, `/api/runs?status=failed`, and `/api/jobs?status=active` so agents and API clients can keep using receipt endpoints directly.

The authenticated shell renders those steers as owner-friendly destinations:

- `/attention` — unread Attention context by kind and session, exact view totals, safe next actions, empty-state receipts, stable `data-attention-api-receipt-href` / `data-attention-source-href` link metadata, and a same-origin `data-attention-seen-form` to mark the current filtered view seen.
- `/runs` — run status summaries for open, running, completed, failed, and aborted work, with `data-runs-api-receipt-href`, `data-run-receipt-href`, and `data-run-events-receipt-href` receipt metadata.
- `/jobs` — recurring job status summaries for active and paused jobs, with `data-jobs-api-receipt-href` and `data-job-history-receipt-href` receipt metadata.

Those rendered pages are Access-protected, preserve the raw API receipts, and should answer the return-loop questions: what needs me, what is running, what finished or failed, where can I safely steer next? In the shell, Check-in bucket links navigate to rendered owner destinations while carrying the authoritative raw receipt href in `data-check-in-raw-href` for proof and debugging.

## Important Limits

| Surface | Current boundary |
|---|---|
| Delegation | At most 2 concurrent children, depth 1, 8 model/tool-loop steps each, and a 120s timeout. Children receive no application, MCP, Browser, Machine, or delegation tools; they still incur model-provider calls and create retained records. The parent retries once only after a stopped platform interruption. Child results have no guaranteed one-hour deletion: a later delegation opportunistically clears older terminal runs. The UI shows a terminal snapshot, not live progress, cancel, or drill-in. |
| Recurring jobs | At most 10 active jobs per owner. Cadence is 60 seconds to 30 days; names are 200 characters and prompts 4,000. D1 drives the UI while the native scheduler drives execution, and they can disagree. There is no automatic repair; if state drifts, pause/delete and recreate the job. |
| Work Code Mode | Generated source is limited to 32 KiB and each Code Mode execution has a 60s wall-clock limit. Saved recipes are owner-approved persisted `work_code` recipes with explicit capabilities and run receipts; they are not a generic extension marketplace. Confinement does not reduce the authority of an allowlisted callback. |
| Workspace | All conversations for one owner share `/home/user`. After a workspace mutation capability runs, My AX attempts an R2 snapshot. Recent writes can be lost, and concurrent conversations can edit the same files without a merge coordinator. |
| Machine | Commands run as the OS account hosting the outbound companion, with that account's filesystem, process, and network permissions. My AX adds no privilege separation. |
| Cloudbox | The adapter can create a run for a public repository, modify its checkout, and execute commands. My AX provides no repository publishing credential; commands retain whatever network authority Cloudbox permits. |
| Browser | Browser Run accepts HTTP(S) URLs that pass public-address checks and does not receive local browser cookies. DNS rebinding remains an infrastructure boundary. Authenticated local browsing works only when a connected Machine explicitly exposes it. |
| Voice and push | Depend on explicit browser permission and provider availability. A failed push does not remove its D1 Attention record. Microphone access begins only from a user action. |

[Feature Status and Limits](./docs/feature-matrix.md) is the current-state inventory: what is real, where it lives, and the known limits.

## One Deployed Happy-Path Demonstration

[![Demo: the agent writes a workspace file, runs a command on a connected machine, and reads a Cloudbox run](./docs/media/my-ax-kitchen-sink.gif)](./docs/media/my-ax-kitchen-sink.mp4)

[Open the accelerated MP4](./docs/media/my-ax-kitchen-sink.mp4). The original interaction took about six seconds; the checked-in video trims startup and runs for 3.4 seconds. It demonstrates one configured path. It does not validate recovery, provider availability, isolation, or every production boundary.

## Deploy

Requirements:

- Node.js 22 and npm 11
- Docker with Colima, Docker Desktop, or WSL2; native Windows shells are not tested
- Python 3, Bash, and OpenSSL
- A Cloudflare account authorized to create Workers, Containers, D1, KV, R2, Workers AI, Browser Rendering, and Dynamic Worker Loader resources; paid usage or product enablement may apply

`setup.sh` deploys infrastructure, but does **not** produce a production-ready or verified service. Review [Deploying My AX](./docs/deploy.md) before running it against an existing account or exposing the hostname.

```bash
git clone https://github.com/acoyfellow/my-ax
cd my-ax
npm ci
npx wrangler login
npx wrangler whoami
# If more than one account is listed:
export MY_AX_ACCOUNT_ID=your_target_account_id
bash scripts/setup.sh
```

The script creates missing named resources, binds configured existing resources, generates absent bridge/encryption secrets, applies pending remote D1 migrations, and deploys. On a fresh Worker it replaces the repository's historical Durable Object migration chain with one current baseline; existing deployments retain their append-only history. When the expected secret source remains available, rerunning setup reuses keys rather than rotating them; it cannot recover deleted keys. Pin `MY_AX_ACCOUNT_ID` whenever Wrangler exposes multiple accounts.

Before sending a real turn:

1. Put the hostname behind a Cloudflare Access self-hosted application.
2. Set `CF_ACCESS_ISS`, `CF_ACCESS_AUD`, `BRIDGE_BASE_URL`, and `CLOUDFLARE_ACCOUNT_ID` as described in the deployment guide.
3. Add bucket-scoped `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` to make workspace snapshots survive container replacement. Without them, treat workspace files as disposable.
4. Confirm the default Workers AI model is available to the account; configure gateway-backed routes only if you intend to expose them.
5. Redeploy, verify anonymous access is rejected, and verify authenticated `/api/health` returns `ok: true`.
6. Open `BRIDGE_BASE_URL` through Access and complete one model turn. Health proves routing and bindings only; when workspace persistence matters, also run the documented snapshot/restore proof.

Push additionally needs VAPID secrets. Managed OAuth callbacks require an Access-gated HTTPS hostname; loopback cannot complete that flow. [Deploying My AX](./docs/deploy.md) contains copy/paste configuration, verification, troubleshooting, and guidance for private deployment wrappers. Each installation must own separate Worker, D1, KV, R2, Durable Object, Access, and secret state; multiple installations may share a source revision but must never share runtime resources.

`npm run check` builds generated assets, typechecks, and runs local tests. It does **not** prove Access, containers, models, voice, push, or workspace restoration. Use the [deployment proof](./proof/README.md) for deployed checks.

## Connect Tools

Open **Settings → Connectors → Add** and enter an HTTPS MCP endpoint reachable from the Worker and allowed by the destination policy. For supported OAuth-enabled servers, My AX attempts metadata discovery and stores grants encrypted with owner-bound context under the deployment-wide `MASTER_KEY`. Incompatible metadata or callback configuration will not connect. Replacing the key without retaining the old value permanently prevents decryption of existing grants.

Connector URLs are screened for embedded credentials and disallowed literal destinations. The operator allowlists exact MCP method identifiers for Code Mode; My AX does not prove that an allowlisted method is side-effect-free.

Optional providers:

- **My Machine** — run [`machinectl`](https://github.com/acoyfellow/machinectl). This grants terminal-equivalent access as the companion's OS user; use a dedicated least-privilege account.
- **Cloudbox** — configure a dedicated `CLOUDBOX_INTERNAL_TOKEN` shared only by this My AX deployment and its Cloudbox service.
- **Web Push** — configure VAPID and grant browser notification permission.
- **Pantry bridge** — set `PANTRY_TOKEN` (and optionally `PANTRY_URL`, default `https://pantry.coey.dev`) to push enabled saved recipes to a pantry for reuse by other agents. Additive, enabled-only, fail-soft, and a no-op without the token. See [Deploying My AX](./docs/deploy.md#pantry-bridge).

## Repository Map

For contributors, the main entry points are:

```text
src/agent.ts          canonical Think agent and tool assembly
src/user-agent.ts     owner root and conversation facets
src/check-in.ts       owner-scoped check-in read model
src/jobs.ts           native recurring schedules
src/job-service.ts    owner-scoped job CRUD and evidence
src/recurring-job-run.ts shared job terminal state and owner receipts
src/saved-recipes.ts  owner-approved reusable work_code recipes
src/delegate-many.ts  bounded Agents-as-tools delegation
src/work-tools.ts     Workspace, Machine, and Cloudbox catalog
src/mcp-code-mode.ts  allowlisted MCP composition
src/routes/           authenticated HTTP adapters
proof/svelte/         product UI and allowlisted result widgets
migrations/           D1 application and projection schemas
```

State ownership and request flows are in [Architecture](./docs/architecture.md).

## Development

```bash
npm ci
npm run check
npm run dev
```

[Local Development](./docs/local-development.md) documents loopback mode and the Access-gated tunnel needed for OAuth callbacks.

## Documentation

- [Architecture](./docs/architecture.md)
- [Feature Status and Limits](./docs/feature-matrix.md)
- [Deploying My AX](./docs/deploy.md)
- [Deployment Proof](./proof/README.md)
- [Security Policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

Bugs and feature requests belong in [GitHub Issues](https://github.com/acoyfellow/my-ax/issues). Report vulnerabilities through the [Security Policy](./SECURITY.md), not a public issue.

## License

MIT
