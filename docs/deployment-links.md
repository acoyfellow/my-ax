# Deployment Links (A2A 1.0)

My AX installations remain independent single-operator systems. A deployment link is a directional, revocable grant allowing one remote installation to submit text for the local operator's review using the A2A 1.0 HTTP+JSON model. It does not share conversations, memory, storage, credentials, MCP servers, models, or tools.

## Supported subset

- Discovery: `GET /.well-known/agent-card.json`
- Send: `POST /a2a/message:send`
- Status: `GET /a2a/tasks/:taskId`
- Input: `role: "user"` with text parts only, at most 32 KiB aggregate
- Initial task state: `input-required`
- Operator outcomes: `completed`, `rejected`, or `canceled`

Streaming, push callbacks, files, artifacts, cancellation by the sender, public directories, transitive trust, and remote execution are not advertised.

## Create a directional grant

Open the receiving deployment through Cloudflare Access and create a grant with its owner API:

```http
POST /api/a2a/grants
Content-Type: application/json

{
  "label": "Alice's My AX",
  "remoteOrigin": "https://alice.example.com",
  "expiresInDays": 30
}
```

The response includes an opaque bearer token exactly once. Transfer it to the remote operator through an authenticated channel. My AX stores only its SHA-256 digest. Creating this inbound grant does not create reverse authority; repeat the process on the other deployment for two-way communication.

List or revoke grants:

```http
GET /api/a2a/grants
DELETE /api/a2a/grants/:grantId
```

Revocation rejects future calls and cancels pending tasks. It cannot erase text already delivered to either installation.

## Send and review

The sender uses the receiving deployment's token:

```http
POST /a2a/message:send
Authorization: Bearer ax_a2a_...
Content-Type: application/json

{
  "messageId": "sender-generated-stable-id",
  "role": "user",
  "parts": [{ "kind": "text", "text": "Please review this request." }]
}
```

The receiver creates one durable task and one Attention item. An exact retry returns the existing task; reusing `messageId` with changed content returns `409`. The local operator decides through:

```http
POST /api/a2a/tasks/:taskId/accept
POST /api/a2a/tasks/:taskId/reject
POST /api/a2a/tasks/:taskId/block
```

`block` also revokes the originating grant. Acceptance is only an acknowledgement—it never injects the text into Think or invokes MCP, Browser, Machine, Workspace, Code Mode, or any local tool.

## Production checklist

1. Keep each installation's Worker, D1, R2, KV, Durable Objects, Access app, and secrets separate.
2. Protect owner APIs with Cloudflare Access.
3. Use a public HTTPS `remoteOrigin` and a short grant lifetime.
4. Transfer bearer tokens out of band; never put them in URLs or logs.
5. Prove duplicate delivery, changed-payload conflict, task isolation, rejection, block, expiry, and revocation between two independent deployments.
