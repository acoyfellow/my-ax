# Deploying My AX

My AX deploys to your Cloudflare account from a Wrangler-authenticated workstation. The bootstrap deploys the Worker before Access is configured. Production app requests are rejected until `CF_ACCESS_ISS` and `CF_ACCESS_AUD` are set; workspace snapshot operations also require R2 S3 credentials.

## Requirements

- Node.js 22+
- npm 11+
- Docker, Colima, or WSL2
- Python 3, Bash, and OpenSSL
- Wrangler authentication
- Cloudflare Workers, Containers, D1, KV, R2, Workers AI, Browser, and Worker Loader access

## 1. Bootstrap Resources and the Worker

```bash
git clone https://github.com/acoyfellow/my-ax
cd my-ax
npm ci

npx wrangler login
npx wrangler whoami

# Required when whoami lists more than one account:
export MY_AX_ACCOUNT_ID=your_target_account_id
bash scripts/setup.sh
```

The setup script:

1. uses the explicitly selected account when `MY_AX_ACCOUNT_ID` is set;
2. creates or resolves D1, KV, and R2 resources;
3. writes their IDs into the local Wrangler configuration;
4. collapses historical Durable Object migrations to one baseline only for a fresh Worker;
5. generates `BRIDGE_JWT_SECRET` and `MASTER_KEY` only when they do not already exist;
6. applies D1 migrations; and
7. deploys the Worker.

The first production deployment intentionally fails closed because `CF_ACCESS_ISS` and `CF_ACCESS_AUD` are empty. The custom hostname may resolve at this stage, but the application is not ready until Access is configured and verified.

## 2. Configure the Hostname and Cloudflare Access

Choose a hostname. For a custom domain, set:

```jsonc
"routes": [
  { "pattern": "ax.example.com", "custom_domain": true }
]
```

Wrangler provisions the custom-domain DNS and certificate when the zone is available in the deployment account. Alternatively, keep `workers_dev: true` for an initial Worker URL.

Create a Zero Trust **Self-hosted** Access application for the final hostname. Set these Wrangler variables:

```jsonc
"vars": {
  "CF_ACCESS_ISS": "https://YOUR-TEAM.cloudflareaccess.com",
  "CF_ACCESS_AUD": "YOUR_ACCESS_APPLICATION_AUD",
  "BRIDGE_BASE_URL": "https://ax.example.com",
  "CLOUDFLARE_ACCOUNT_ID": "YOUR_ACCOUNT_ID",
  "BACKUP_BUCKET_NAME": "my-ax-homes"
}
```

Production requests remain rejected if the Access issuer or audience is absent. The `--env dev` configuration is the only local identity bypass.

## 3. Configure Durable Workspace Snapshots

The R2 binding stores backup objects, but Cloudflare Sandbox snapshot transfer also needs bucket-scoped S3 credentials.

Create an R2 API token with **Object Read & Write** access limited to the `my-ax-homes` bucket, then set:

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

If either credential is absent, workspace snapshot operations return an error.

## 4. Configure Web Push

Generate a VAPID P-256 key pair using a trusted Web Push key generator, then set:

```bash
npx wrangler secret put VAPID_SUBJECT       # mailto:you@example.com
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

Push is optional for basic chat, but completion attention, background decisions, and app badges need these values.

## 5. Configure Model Routing

Workers AI-backed models use the `AI` binding. Gateway-backed catalog entries require deployment-owned gateway configuration and credentials. Remove or disable routes you do not configure; users never enter provider keys in the product UI.

The exact gateway contract is deployment-specific and should be injected outside the tracked public tree.

## 6. Configure Optional Providers

### My Machine

`machinectl` is a separate optional companion: <https://github.com/acoyfellow/machinectl>.

It connects outbound to My AX and publishes a live capability catalog. Configure and run it only on a computer whose local authority you intend to expose. My Machine is terminal-equivalent authority, not a sandbox.

### Cloudbox

A compatible Cloudbox deployment adds bounded repository runs to Work Code Mode. Configure:

```jsonc
"vars": {
  "CLOUDBOX_URL": "https://your-cloudbox.example.com"
}
```

Then set the shared deployment secret:

```bash
npx wrangler secret put CLOUDBOX_INTERNAL_TOKEN
```

The same value must be configured on Cloudbox. Current integration methods create a live run, read and write relative files, and execute bounded commands. Cloudbox is optional; My AX Workspace and connected MCPs work without it.

## 7. Deploy and Verify

```bash
npm run check
npm run verify:public
npm run deploy
```

Verify both boundaries:

1. an unauthenticated request is redirected or rejected by Access;
2. an authenticated `GET /api` returns `{ "ok": true }` from My AX itself.

Applying Access only at the edge is insufficient if the Worker's configured issuer or audience is stale.

## Independent Installations and Deployment Wrappers

Every My AX installation is one security and state boundary. Two installations—even when owned by the same person—must use distinct:

- Worker and container application names;
- D1, KV, and R2 resources;
- Durable Object namespaces;
- `MASTER_KEY`, bridge, push, and snapshot credentials;
- Access applications and owner policies; and
- deployment configuration.

Do not point two installations at one D1 database or copy a configured `wrangler.jsonc` between accounts. Sharing source code is expected; sharing runtime state or credentials is not.

For repeatable production operation, keep a **private deployment wrapper** outside the public engine. A wrapper should clone or check out an exact public revision, inject non-public account/hostname/Access configuration, resolve deployment-owned resources, run checks and migrations, and deploy. It must not patch product behavior or commit secrets. This is also the recommended foundation for future A2A deployment links: independently deployed instances communicate through explicit protocol grants, not shared storage.

## Update a Deployment

```bash
git pull --ff-only
npm ci
npm run check
npx wrangler d1 migrations apply my-ax-db --remote
npm run deploy
```

Treat `MASTER_KEY` as durable state. `scripts/setup.sh` preserves an existing value. Manually replacing it makes existing encrypted connector grants unreadable and requires users to authorize them again.

## Troubleshooting

### Authentication Error `10000`

Wrangler's token expired or targets the wrong account:

```bash
npx wrangler whoami
npx wrangler login
```

### Container Build Failed

Inspect Docker/Colima health and the Wrangler build output. The Sandbox image is Linux/AMD64.

### Worker Returns an Auth Error After Access Succeeds

Confirm `CF_ACCESS_ISS` and `CF_ACCESS_AUD` match the Access application protecting the deployed hostname.

### Workspace Restore Is Unavailable

Confirm both R2 S3 secrets are set and scoped to the configured backup bucket. An R2 binding by itself is not enough for presigned snapshot transfer.

### Roll Back

Loop-managed releases follow [`docs/loop/release.md`](./loop/release.md). Before deployment, record the prior Worker version ID, prior git revision, candidate revision, migration reversibility, rollback owner, exact rollback surface, and post-rollback proof.

```bash
npx wrangler deployments list
```

Use the Cloudflare dashboard's Worker deployment history to select the recorded prior version. Rollback is complete only after the prior version is active and the changed production journey passes its rollback proof. Autonomous irreversible migrations are prohibited.
