# My AX Deployment Proof

The scripts in `proof/` check a deployed Worker's routing, Access boundary, binding and secret presence, selected browser behavior, and artifact cleanup. They do not establish model quality, general security, downstream credential validity, or long-term availability.

## Proof Commands

### Worker and Access Wiring

```bash
export MY_AX_BASE_URL="https://your-host"
export CF_ACCESS_CLIENT_ID="<service-token id>"       # when Access is enabled
export CF_ACCESS_CLIENT_SECRET="<service-token secret>"
npm run prove
```

`proof/plan.ts` checks:

| Gate | Check | Limit |
|---|---|---|
| `edge-alive` | The hostname reaches a response. | Does not identify every intermediary serving the response. |
| `service-token-admitted` | The configured Access service token reaches `/api/health`. | Checks one policy path, not the complete Access policy. |
| `health-body-ok` | The Worker returns `ok:true`, configured binding names are present, and required secret names are nonempty. | Does not validate secret permissions or downstream service health. |
| `policy-enforced` | An anonymous request is rejected or redirected before app data is returned. | Does not test every route or identity policy. |

The command prints one summary and exits `0` when all configured gates pass. Set `PROOF_JSON=1` to append the structured result.

### Browser Path

```bash
npm run prove:browser
```

`proof/browser-e2e.mjs` uses the approved browser wrapper and an isolated Chrome For Testing profile. The profile must already hold an operator-owned Access session when the deployment is protected.

The script checks the app shell, owner API shapes, desktop/mobile geometry, one Think chat turn, session cleanup, and selected result widgets. It calls a configured model and can incur inference cost. The model roundtrip has a bounded timeout in the script; passing once does not establish provider availability.

Optional paths:

```bash
MY_AX_PROVE_SVELTE_ARTIFACT=1 npm run prove:browser
MY_AX_PROVE_PUSH=1 npm run prove:browser
```

The first creates and removes a temporary Svelte artifact. The second sends a real push to registered owner devices and checks the durable unread row; push delivery remains dependent on the browser push service.

### Artifact Storage and Cleanup

```bash
npm run prove:artifacts
```

This script writes one owner-scoped Svelte manifest to R2/D1, fetches its preview, deletes the temporary conversation, and checks that the preview and artifact index row are gone.

### Local Receipt Primitive

```bash
npm run test:run-receipts
```

This test covers the owner-scoped append helper used by `/api/runs/:id/events` and explicit connected-machine observations. The ledger records events callers append; it is not an automatic transcript of every model or tool action.

## Why `/api/health` Is Outside Identity Middleware

`src/index.tsx` mounts `GET /api/health` before `accessMiddleware`. It reports:

- Worker version from `CF_VERSION_METADATA`;
- Cloudflare colo from `request.cf` when available;
- required binding names and whether each is present;
- missing required secret names, never values;
- an ISO timestamp.

The handler does not read owner data or open a Sandbox. Cloudflare Access can still protect the hostname before the request reaches this route.

## Reuse in Another Worker

The wiring proof assumes a health endpoint with the same response shape. To adapt it, change `MY_AX_BASE_URL` and update the gates in `proof/plan.ts` to match the other Worker's bindings and identity boundary. Do not copy the current required-binding list without reviewing the target Worker.
