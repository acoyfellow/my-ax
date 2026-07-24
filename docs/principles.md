# Principles

These are the theories that drive My AX. Each one is a design rule, not a slogan. Each claim below points to code so you can check it.

## 1. Verify, do not trust

This is the rule over all the other rules. My AX does not report that work happened. It reports evidence that work happened.

- Every saved-recipe run and every recurring job run appends a start event and a terminal event to an owner-scoped ledger. See `src/run-receipts.ts`.
- A Terrarium cloud run returns a receipt with a run id, a task fingerprint, and a nonce. The caller checks the receipt. See `src/terrarium-tools.ts`.
- The public tree passes a leak gate before release. See `npm run verify:public`.
- The feature status page marks each capability with evidence, or it marks the gap. See `docs/feature-matrix.md`.

The same rule applies to this document. If a line here is not backed by code, it does not belong here.

## 2. No token is wasted

Model tokens cost money and time. My AX treats each cycle as a measured unit, not a free action.

- Each turn records per-cycle model usage: input tokens, output tokens, total tokens, model, and finish reason. See `src/cycle-costs.ts` and `migrations/0013_cycle_cost.sql`.
- The owner reads the usage series through `/api/cost-series`. See `src/routes/cost-series.ts`.
- A reusable tool runs saved code instead of deriving the procedure again. One Workers AI Kimi K2.7 measurement on 2026-06-29 showed about a 72% drop in output tokens for a repeated procedure. A 2026-06-30 run measured 394 output tokens to derive a small procedure from scratch and 157 to run it from a recipe. For that small procedure, total tokens rose, because the recipe call added input and tool overhead. The measurement is recorded, not rounded up.

The goal is not zero tokens. The goal is that no token spend is invisible. Observability is the default, not an add-on.

Current limit: there is no declared SLO or dashboard yet. Structured console events, health checks, run receipts, and the cost series exist. A single reconciliation service does not. See the Observability row in `docs/feature-matrix.md`.

## 3. Parallel-first, inside real limits

The default posture is to fan work out, not to block on one long step.

- `terrarium.spawn_background` starts a bounded cloud run and returns a run id at once. The owner polls with `terrarium.status`. Work continues in parallel. See `src/terrarium-tools.ts`.
- `delegate_many` fans out to independent read-only analysis children.

Honest limit: `delegate_many` runs its children serially today, not concurrently. Two concurrent children hit the shared Workers AI per-minute inference cap (error 3021) and both failed. The policy now runs children one at a time, and marks any not-yet-started child "deferred" rather than failing it. See `src/delegate-serial.ts`.

So the theory is parallel-first, and the practice is parallel where the shared inference limit allows it. When the limit changes, the practice widens. The rule stays the same: prefer independent, resumable work over one blocking chain.

## 4. Recipes are the reuse layer

A recipe is a procedure the agent learned once and can run again. Recipes are how a session's work stops being throwaway.

- The agent proposes a reusable tool only for successful code that carries an explicit marker. Review-first is the default. The owner approves and enables it, or turns on automatic enablement. See `src/work-tools.ts` and `src/saved-recipes.ts`.
- Reuse runs the exact saved code. It does not regenerate it. This is the mechanism behind principle 2.

Pantry is the store that lets a recipe leave My AX. Pantry is a capability-scoped recipe store on Workers and D1. It stores scripts and hands them back. It never runs them. `src/pantry-sync.ts` pushes My AX's enabled recipes, projected to the codemode snippet shape, to a live pantry (`pantry.coey.dev` by default). A recipe authored in My AX then becomes reusable from a Terrarium run or a Pi session through the pantry tool.

The sync is additive, env-gated, and fail-soft. With no token it is a clear no-op. A network error is logged and skipped. It never throws into a My AX flow. See the design rules at the top of `src/pantry-sync.ts`.

The bet: a durable, portable, capability-scoped recipe layer is a large part of how agent work compounds instead of resetting each session.

## 5. Dogfood the platform, and dogfood our own tools

My AX binds Cloudflare primitives directly: Workers AI, Durable Objects, D1, R2, KV, Containers, Sandbox, Worker Loader, Browser Rendering, AI Gateway, and Access. See `wrangler.jsonc` and the "Built on Cloudflare" panel on the docs home.

On top of those primitives, My AX also uses tools built in this same workspace:

| Dependency | What it is | Where My AX uses it |
|---|---|---|
| `@cloudflare/codemode` | One async program drives many tools in a namespace | `src/work-tools.ts`, `src/cm-snippets.ts` |
| `@cloudflare/think` | Durable conversation and turn engine | `src/agent.ts` |
| `@cloudflare/voice` | Voice turns into the canonical conversation | `src/voice-think-agent.ts` |
| `@cloudflare/sandbox` | The `/home/user` container workspace | `src/workspace.ts` |
| Terrarium | Bounded cloud agent runs with receipts | `src/terrarium-tools.ts` |
| Pantry | Capability-scoped recipe store | `src/pantry-sync.ts` |
| Machinectl | Owner's own machine over an authenticated relay | `src/routes/machinectl.ts` |
| Promotion Atom | Deterministic evidence-to-promotion decision kernel | recipe promotion policy |

This is deliberate. If a tool is not good enough to run My AX, it is not good enough to ship. My AX is the first user of each one.
