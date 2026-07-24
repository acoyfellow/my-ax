# Implementation Patterns

## 1. Forward the User's OAuth Grant

My AX stores each connector's OAuth token in a Durable Object keyed by the verified Access identity. When Think calls a connected MCP method, the Worker resolves that user's token, refreshes it when needed, and forwards the call. The model receives the tool result, not the bearer.

```text
Access identity
  -> OAuthClientDO (encrypted token)
  -> Agent.mcp (bearer attached by the Worker)
  -> upstream MCP
```

This preserves user attribution only when the MCP server and its upstream OAuth flow preserve it. My AX cannot add per-user attribution to a server that uses a shared credential.

Relevant code:

```text
src/connectors.ts
src/oauth-store.ts
src/bridge.ts
```

## 2. Borrow MCP Tools at Runtime

Connected MCP servers contribute their catalog to the Think session through `Agent.mcp`. My AX does not reimplement each upstream API, but it still owns connector discovery, destination validation, OAuth storage and refresh, forwarding timeouts, and failure handling.

An operator can expose an exact read/query subset to `mcp_code_mode`. New or unlisted methods remain native-only until the policy changes.

```text
connected MCP tools
  -> native tool       one call or explicit side effect
  -> mcp_code_mode     reviewed multi-call read/query program
```

## 3. Route Computer Work by State

`work_search` and `work_code` present several locations without publishing every underlying operation as an eager model tool.

```text
workspace.*  snapshot-backed /home/user
machine.*    outbound-connected physical machine
terrarium.*  bounded cloud agent run (verified receipts)
page.*       live browser UI (only while a chat tab is connected)
codemode.*   discover/describe/run tools + owner-approved reusable tools
```

The distinction follows state, not geography. My AX Workspace and Terrarium both run on Cloudflare. My Machine matters because it contains current local checkouts, desktop state, and authentication that do not exist in either remote environment. The Page connector is different again: it resolves over the owner chat WebSocket to steer the owner's own browser session, so it works only while a chat tab is open.

The Dynamic Worker receives a generated bridge containing only the methods selected by the host. It has no ambient network access. That isolation does not reduce the authority of a method such as `machine.shell`; the host callback still runs with the connected user's terminal permissions.

Relevant code:

```text
src/work-tools.ts
src/routes/machinectl.ts
src/terrarium-tools.ts
proof/svelte/page-registry.ts
proof/svelte/artifact-tools.ts
```

## 4. Keep the Workspace Local, Snapshot the Boundary

Each user gets a Cloudflare Sandbox container. Ordinary file operations use container-local `/home/user`. At turn end, My AX writes a Sandbox backup to R2 and stores the latest successful backup pointer in D1.

```text
turn starts
  -> restore latest successful backup when needed
  -> /home/user (file and process work)
  -> turn ends after a mutating tool
  -> snapshot to R2; update D1 pointer on success
```

A container failure can lose writes made after the last successful snapshot. Root filesystem changes are not part of the durable contract; user files and user-local tools belong under `/home/user`.

## 5. Separate Live Conversation State From Its Projection

Think owns the active conversation, tool loop, recovery, and compaction. D1 stores an owner-scoped session index plus a projection of new turns for search, incremental feeds, and export.

The projection is useful for human history and external synchronization. It does not replace Think's live inference state.

External automation uses owner-authenticated endpoints:

```text
POST /api/sessions/:id/inject
GET  /api/sessions/:id/entries?after=<cursor>
GET  /api/sessions/:id/export?format=json|markdown
```

## 6. Use Push as a Hint, Not a Queue

Installed PWAs may subscribe to Web Push. `notify_owner` writes an Attention item before attempting delivery, so the durable inbox remains available when a push is delayed or rejected.

Push requires VAPID configuration and browser support. Delivery is best-effort. Durable jobs and Think submissions, rather than the browser or push service, own scheduled execution.

Notification and Attention links carry the target session. Warm PWA launches send that target to the mounted chat, which switches its active session instead of reloading cached state.

## 7. Render Only Known Result Types

Model-adjacent output cannot choose arbitrary UI components. `tool-result-widgets.ts` recognizes a small set of result shapes:

- owner-scoped raster artifacts;
- same-origin Browser Run replay URLs;
- same-origin Svelte artifact previews.

Unknown results render as inert text. Svelte artifacts run in an `allow-scripts` iframe without same-origin authority, and the preview route supplies a restrictive CSP.

Relevant code:

```text
proof/svelte/tool-result-widgets.ts
proof/svelte/ToolResultWidget.svelte
src/artifacts.ts
src/routes/browser.ts
```
