# Deploying My AX without machine access

Goal: ship updates when the Mac (machinectl companion) is closed, locked, or
disconnected. The laptop was the single point of failure because it was the only
place that had **(1) a Docker daemon** to build the Sandbox container image and
**(2) the wrangler OAuth login** to authorize the deploy. This removes both
leashes.

## The two classes of deploy

| Class | What changed | Needs Docker? | Path |
|---|---|---|---|
| **A — hotfix** | code only: `src/**`, assets, migrations. Dockerfile unchanged. ~90% of updates. | No | `scripts/deploy-remote.mjs` from the workspace container or a Terrarium run |
| **B — full** | Dockerfile / container base / build context changed (or a normal full deploy) | Yes | GitHub Actions `deploy` workflow (runner has Docker) |

Why the split works: `wrangler deploy` only needs Docker to rebuild the Sandbox
image. If the Dockerfile is unchanged, Class A **pins the container to the image
already in the registry** and deploys the Worker alone — no Docker, no Mac.

## One-time bootstrap (only you can do this once)

An agent cannot mint its own deploy credentials. Plant these once, off-machine:

1. **Cloudflare API token** — Cloudflare dashboard -> My Profile -> API Tokens.
   Scopes: `Workers Scripts:Edit`, `Workers Builds / Cloudflare Images:Edit`
   (container registry push), `D1:Edit`, `R2:Edit`, `Account Settings:Read`,
   and `Zone DNS:Edit` (**required** for `custom_domain: true` — this missing
   scope is the classic silent deploy failure).
2. Add it as GitHub Actions secret `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`).
   Put `CF_ACCESS_AUD`/`CF_ACCESS_ISS`/`BRIDGE_BASE_URL`/routes in the committed
   `wrangler.jsonc` of your private fork — NOT as `--var` (see warning below).
3. **GitHub fine-grained PAT** — `Actions: read and write` on the deploy repo.
   Store it as a My AX secret/connector so the agent can trigger deploys.
4. For the Class A fast-path, also expose `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, and `MY_AX_SANDBOX_IMAGE` (the pinned registry ref
   the `deploy` workflow records) to the workspace/Terrarium environment.

> IMPORTANT: the **public** `my-ax` repo ships **empty** `CF_ACCESS_AUD`,
> `CF_ACCESS_ISS`, `BRIDGE_BASE_URL` and `routes: []` in `wrangler.jsonc` (they
> were scrubbed for the OSS release). Deploying public main verbatim blanks your
> Access config and drops your custom domain — auth breaks.
>
> Do NOT try to patch them back with `wrangler deploy --var`: on wrangler
> >= 4.100 a CLI `--var` **replaces the entire vars block**, silently wiping
> every var you didn't pass (this repo already got bitten — it wiped
> `CF_ACCESS_ISS`). Instead, run this workflow from the repo/fork that carries
> your **real** committed `wrangler.jsonc` (routes/custom_domain + AUD/ISS),
> e.g. `my-ax-private`, or apply `employee-config.patch` in a checkout step.

## How you deploy after bootstrap

- **Full deploy (Class B), from anywhere including the agent:**
  ```
  node scripts/trigger-deploy.mjs "why this deploy"
  ```
  or push a `v*` tag, or click "Run workflow" in GitHub. The runner builds and
  pushes the container image and deploys.

- **Hotfix (Class A), Docker-free, from the workspace or Terrarium:**
  ```
  node scripts/deploy-remote.mjs --dry-run   # validate first
  node scripts/deploy-remote.mjs             # deploy Worker, pinned image
  ```
  Refuses automatically if the Dockerfile changed and tells you to use Class B.

## Flow (zero Mac)

```
chat message -> My AX agent -> GitHub API (workflow_dispatch)
             -> GitHub Actions (Docker) -> wrangler deploy -> Cloudflare
```
or, for hotfixes:
```
chat message -> My AX agent -> workspace/Terrarium -> wrangler deploy (pinned image)
```

## First-run validation checklist

1. Bootstrap the token + secrets above.
2. Trigger Class B once; confirm the Worker and container both deploy and the
   run records `MY_AX_SANDBOX_IMAGE`.
3. Confirm authenticated `GET /api/health` returns `ok: true`.
4. Make a trivial `src/**` change, run `deploy-remote.mjs --dry-run`, then real;
   confirm it deploys with no Docker and health stays green.
5. Bump the Dockerfile; confirm `deploy-remote.mjs` refuses and Class B succeeds.
