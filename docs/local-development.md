# Local development

Two modes:

## 1. Fast loopback mode

```bash
npm run dev
```

Uses the `ENVIRONMENT=dev` + `DEV_USER_EMAIL=dev@localhost` identity bypass.
Good for UI/runtime work where you don't need to exercise the connector OAuth
flow against a real upstream. OAuth callbacks won't work — Managed OAuth
providers require HTTPS redirect URIs.

## 2. Access-gated tunnel mode

For exercising the connector OAuth flow end-to-end, you need an HTTPS
hostname Access can sit in front of:

```bash
npm run dev:access         # terminal 1 — wrangler dev with Access-on vars
npm run dev:access:tunnel  # terminal 2 — cloudflared tunnel to the hostname
```

Then open the tunnel hostname (NOT `localhost:8788`).

### One-time control-plane setup

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
