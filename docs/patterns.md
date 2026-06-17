# Patterns

This repo is a working example of a few patterns that recur in personal
agent apps on Cloudflare.

## 1. The agent acts as the user, not as itself

For MCP servers that support user OAuth, My AX preserves the user's identity
instead of introducing a shared agent credential. The upstream's attribution
still depends on that server's OAuth and audit implementation; My AX does not
claim to retrofit user attribution onto arbitrary APIs.

The intended pattern uses **OAuth 2.0 + Managed OAuth** (see
[Managed OAuth for Access](https://blog.cloudflare.com/managed-oauth-for-access/)).
The user completes consent, and the resulting token is scoped to them, stored
encrypted in a per-user Durable Object, and refreshed before expiry.

## 2. The agent's tool catalog is borrowed, not built

The agent doesn't host its own MCP server. It piggybacks on whatever MCP
servers you connect in Settings → Connectors:

```
my-ax (this repo)
   │  Agent.mcp registers each MCP with the user's refreshed OAuth bearer
   │  Think exposes discovered MCP tools directly to the model
   ▼
Your chosen MCP servers (anywhere on the public internet)
   │  validates token, enforces server-side policy, executes
   ▼
Upstream systems (your wiki, your tracker, your code host, your inbox, …)
```

Cost: ~0 ops on the agent side. Benefit: any MCP catalog you can authorize.

## 3. One work surface, three places

The model does not receive separate eager tools for every filesystem, process,
laptop, and Cloudbox operation. `work_search` discovers capabilities and
`work_code` executes one bounded JavaScript program over explicit namespaces:

```text
workspace.*  My AX Workspace — persistent conversation-adjacent files/processes
machine.*    My Machine — current physical state and authenticated local tools
cloudbox.*   Cloudbox — clean bounded repository runs and receipts
```

The namespace names describe product ownership rather than infrastructure
geography: both the My AX Workspace and Cloudbox run on Cloudflare.

Every user still gets a Cloudflare Sandbox SDK container. Its `/home/user` is
the fast persistent My AX Workspace, snapshotted to R2 and restored into fresh
containers. It is useful for uploads, notes, transforms, scripts, and previews;
it is not presented as the user's physical development machine.

`machine.*` is terminal-equivalent authority and only appears when an
outbound-connected `machinectl` companion is available. `cloudbox.*` is
optional and currently run-oriented: clean clone, read/write, bounded command,
and receipts. Code Mode receives no raw credentials, bindings, environment, or
ambient network access.

## 4. Native agent runtime, product-owned workspace

Production chat runs on **Cloudflare Think** for durable messages, stream
replay/recovery, reasoning, and programmatic turns. `src/think-workspace.ts`
adapts native Think workspace tools onto Sandbox-local `/home/user`, while
`src/work-tools.ts` owns composition across the three work providers.

## 5. It's mobile-first, on purpose

The same PWA, the same OAuth state, and the same Think-era conversation
list works on a phone. The conversations sidebar slides in from the left.
The settings drawer slides up from the bottom.

## 6. Conversation state is durable across devices

Think owns live conversation history and recovery. D1 stores an
owner-scoped registry and an indexed mirror of new Think turns used for
search, sync feeds, and exports. Open my-ax on your phone, resume a
conversation, or inject a durable turn from automation.

## 7. Push is an agent attention channel

Installed apps can subscribe to Web Push. The owner-scoped `notify_owner`
tool allows the Think agent to notify that user's subscribed devices
without exposing a cross-user delivery parameter.

---

## How to adopt these patterns in your own project

If you want to build a sibling app with the same auth model:

1. **Create a Cloudflare Access app** (if you want SSO at the edge) for
   your hostname. Note its AUD.
2. **Wire `src/connectors.ts`** in your project with one or more MCP
   server entries (`upstream`, `auth.kind: "oauth-bearer"`, `resource` per
   RFC 8707).
3. **Users do the OAuth dance once** per browser via
   `/api/connectors/<id>/authorize` → SSO → consent screen → done.

The heavy lifting (token storage, refresh, per-user scoping, RFC 8707
resource indicator, audit receipts) is in `src/oauth-store.ts` +
`src/bridge.ts` and is copy-pasteable.
