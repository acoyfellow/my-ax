# my-ax smoke proof

Reusable claim-and-prove harness against a deployed my-ax worker. Vanilla
TypeScript: `fetch` + assert + a colored summary. No external runtime
dependencies.

## Two proof layers

`npm run prove` is the identity-free Access and Worker wiring receipt
suitable for CI-style reachability checks.

`npm run prove:browser` is the operator dogfood receipt. It drives an
isolated Chrome For Testing profile against your deployed worker,
requires an existing Access session in that profile (when you front the
worker with Access), checks the trimmed product boundary and
desktop/mobile app-bar geometry, performs one real Think chat roundtrip
through the UI, then deletes its temporary session. To deliberately
generate and exercise one live inline Svelte artifact in that temporary
conversation, opt in with `MY_AX_PROVE_SVELTE_ARTIFACT=1
npm run prove:browser`. To deliberately send a real phone push and verify
its durable unread row too, opt in with `MY_AX_PROVE_PUSH=1
npm run prove:browser`.

`npm run prove:artifacts` is a narrower post-deploy storage/cleanup
verifier for the durable artifact plumbing. It seeds one owner-scoped
preview manifest into R2/D1, retrieves it through
`/api/artifacts/:id/preview`, deletes its temporary conversation, and
verifies the preview and artifact index row disappear.

`npm run test:run-receipts` is a focused local check for the shared
owner-scoped append primitive used by `/api/runs/:id/events` and the
explicit connected-laptop observation paths.

## What `npm run prove` proves

| Gate | Receipt |
|---|---|
| `edge-alive` | Hostname routes to the worker. |
| `service-token-admitted` | When fronted with Access, a Service Auth token is accepted; `/api/health` returns 200. |
| `health-body-ok` | All required bindings present, zero required secrets missing, the worker reports `ok:true`. |
| `policy-enforced` | When fronted with Access, anonymous requests are gated upstream of the worker. |

## Run identity-free wiring proof

```bash
export MY_AX_BASE_URL="https://your-host"          # required
export CF_ACCESS_CLIENT_ID="<service-token id>"    # if you front with Access
export CF_ACCESS_CLIENT_SECRET="<service-token secret>"
bun proof/plan.ts
# or
npm run prove
```

Result: a one-screen colored summary (PASS/FAIL per gate, worker version
and region from the receipt). Exit code 0 → green; 1 → red. Set
`PROOF_JSON=1` to also emit a structured JSON envelope after the human
summary.

## Why /api/health is identity-free

`src/index.tsx` mounts `GET /api/health` **before** `accessMiddleware`.
It returns a structured envelope reporting:

- worker version (from `CF_VERSION_METADATA`)
- region (from `request.cf.colo`)
- presence of every required binding (true/false, no values)
- list of missing required secrets (names only, no values)
- current ISO timestamp

It never reads user data, never touches identity, never opens a Sandbox.

## Reusing this elsewhere

The pattern is portable. To monitor another app:

1. Mint a service token (Zero Trust → Access → Service Auth) — if you
   front with Access.
2. Add an Access policy with action `Service Auth`.
3. Add an identity-free `GET /api/health` endpoint, mounted before any
   identity middleware.
4. Copy `proof/plan.ts` and change `MY_AX_BASE_URL`.
