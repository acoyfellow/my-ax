# Local Development

Both modes require Docker, Colima, or WSL2 for the Sandbox container.

## 1. Fast Loopback Mode

```bash
npm install
npm run db:migrate:local   # first run, and whenever migrations change
npm run dev
```

Open `http://localhost:8787`. This mode builds the browser assets, watches the
Worker, and uses the `ENVIRONMENT=dev` and `DEV_USER_EMAIL=dev@localhost`
identity bypass. Use it for UI and runtime changes that do not require an HTTPS
OAuth callback. Managed OAuth callbacks do not work on the loopback URL.

If port 8787 is already occupied, keep the normal asset build and choose an
explicit review port:

```bash
npm run build:assets
npx wrangler dev --env dev --port 8790
```

Settings can be opened with the gear button or `Cmd+K` / `Ctrl+K`, which makes
responsive settings work easy to review without a deployed environment.

## 2. Access-Gated Tunnel Mode

For exercising the connector OAuth flow end-to-end, you need an HTTPS
hostname Access can sit in front of:

```bash
npm run dev:access         # terminal 1 — wrangler dev with Access-on vars
npm run dev:access:tunnel  # terminal 2 — cloudflared tunnel to the hostname
```

Open the tunnel hostname. Requests sent directly to `localhost:8788` bypass the Access path under test.

### One-Time Control-Plane Setup

Pick a hostname and reserve a named Tunnel:

```text
Tunnel:   my-ax-local                (your choice)
Origin:   https://my-ax-local.example.com
Callback: https://my-ax-local.example.com/api/connectors/<id>/callback
```

1. Create a Cloudflare Tunnel and route the hostname to it
   (`cloudflared tunnel route dns my-ax-local my-ax-local.example.com`).
2. Front the hostname with a Cloudflare Access self-hosted application; pull
   the AUD from the Access app's settings.
3. If you're testing against an upstream MCP server that uses pre-registered
   OAuth clients (not DCR), add the local callback to its redirect allowlist.
4. Tunnel credentials stay in `~/.cloudflared/` only.

The tunnel makes the local Worker reachable at the configured hostname. Keep
Access enabled, and remove the DNS route, Tunnel, and Access application when
the development hostname is no longer needed.

### Environment

```bash
export MY_AX_LOCAL_PORT=8788
export MY_AX_LOCAL_TUNNEL=my-ax-local
export MY_AX_LOCAL_ACCESS_ORIGIN=https://my-ax-local.example.com
export MY_AX_LOCAL_ACCESS_AUD=<your-access-app-aud>
export MY_AX_LOCAL_ACCESS_ISS=https://<your-team>.example.com
```

The script rejects non-HTTPS origins and refuses to start if any of these
are unset.
