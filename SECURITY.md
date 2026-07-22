# Security Posture

My AX is a single-operator agent. One person deploys it, one verified identity
owns it, and that identity authorizes every action. This page states the trust
model, the identity and network boundaries, what each execution place can do,
and what My AX does not do. It is written for a security reviewer.

## Trust Model

My AX is not multi-tenant. One owner runs one deployment in their own Cloudflare
account. The owner authorizes the agent to act with the owner's own authority.

My AX is not a remote-access tool. It takes no inbound connection to any machine
the owner connects. The agent acts through paths the owner configures, gates with
Cloudflare Access, and can stop.

The agent does the work. The owner approves it, steers it, and stops it. Every
action writes a receipt the owner can read.

## Identity And Authentication

Cloudflare Access verifies every request at the edge. `src/auth.ts` then
verifies the Access JWT against the JWKS: it checks the issuer, the audience, the
signature, and the expiry. It extracts the email and attaches the identity to
the request context.

Every route reads that identity and scopes its data by email. The Sandbox
container, the OAuth token store, and the D1 session rows are all keyed by email.
A request without a verified identity is rejected.

Local development can bypass Access only when three conditions all hold:
`ENVIRONMENT=dev`, the Access issuer and audience are empty, and `DEV_USER_EMAIL`
is set, together with a local-runtime signal. A deployed Worker cannot enter this
path.

## Network Posture

The machine companion connects outbound only. It opens no inbound port, exposes
no public tunnel, and accepts no bearer-token-in-a-URL. It connects to the one
Worker endpoint the owner configures.

The Worker exposes no unauthenticated surface for owner data. `workers_dev` and
preview URLs are disabled, so the Access-gated custom domain is the only route.

A shared public-URL policy screens connector and browser destinations. It rejects
private, loopback, link-local, and reserved addresses, and rejects URLs that
carry credentials. The Browser Run path validates both the requested URL and the
final URL.

## Capability Boundaries

Generated code runs in a bounded sandbox. Work Code Mode gives the Dynamic Worker
a 60-second wall-clock limit, a 32,000-byte source limit, and no ambient network
access. The sandbox has no direct database, secret, or network binding. It calls
allowlisted server-side handlers only. A handler keeps its normal authority; the
sandbox does not add or remove it.

Connector tokens are stored encrypted. `OAuthClientDO` encrypts each grant under
the deployment-wide `MASTER_KEY` with owner-bound context and refreshes it before
expiry. The model never sees a bearer token; a trusted server-side adapter
attaches it.

Tool calls through the bridge carry a scoped ticket. `src/bridge.ts` mints a
short-lived ticket, verifies its scope, attaches the upstream credential, and
writes an audit receipt to `AUDIT_KV` with a 90-day retention. Each record holds
the caller, the target, the method, and the timestamp.

The connector operator allowlists exact MCP method identifiers for Code Mode. My
AX does not prove that an allowlisted method has no side effect.

## The Machine Companion

The machine companion ([machinectl](https://github.com/acoyfellow/machinectl))
is the highest-authority place the agent can act, and it is opt-in. The owner
installs it and runs it. It is not installed or reachable by default.

Its `shell` tool is terminal-equivalent. It can read credentials, run programs,
delete files, or move data as the local user. `MACHINECTL_ALLOWED_PATHS`
constrains an explicit working directory; it does not constrain the content of a
shell command. This is a deliberate trust model, not a sandbox.

Run the companion only under these conditions:

- Run it under a dedicated, least-privilege OS account.
- Trust the model or person that sends commands.
- Trust the MCP clients your Access policy permits.
- Trust the Worker deployment the companion connects to.

Do not use the machine companion for a workload whose data policy requires
container isolation, credential-file blocking, or a read-only working directory.
Use the container workspace or a Terrarium run for those workloads.

## What My AX Does Not Do

- It does not accept an inbound connection to a connected machine.
- It does not let a third party control a machine. One verified owner authorizes
  the agent.
- It does not run without Cloudflare Access in production.
- It does not expose owner data on an unauthenticated URL.
- It does not send data outside the deployment except to the model providers,
  MCP servers, and services the owner configures. Each receives only what the
  agent sends it and retains data under its own policy.
- It does not guarantee container isolation on the machine-companion path. That
  path runs as a real OS account.
- It does not physically delete a Durable Object when the owner deletes a
  session. Deletion removes owner reachability and indexed data.

## Data Handling

Cloudflare Access identity is the owner key. D1 stores the session registry, a
projected transcript index, push subscriptions, Attention, jobs, and appended run
receipts. R2 stores upload bytes and workspace snapshots. `AUDIT_KV` stores
bridge call receipts for 90 days.

Workspace snapshots are point-in-time backups, not continuous replication. A
container failure can lose writes made after the last successful snapshot.

## Deployment Boundary

The public repository is a generic engine. Organization-specific hosts, account
resources, MCP catalogs, Access settings, and secrets belong in a private
deployment wrapper. They must not be committed to the public repository.

Each installation must own separate Worker, D1, KV, R2, Durable Object, Access,
and secret state. Installations may share a source revision. They must never
share runtime resources.

## Compliance Mapping

State the controls your organization requires against the boundaries above. Do
not treat this section as a compliance claim. It is a place for the deploying
team to record the mapping it has verified.

| Control area | Where My AX addresses it |
|---|---|
| Authentication | Cloudflare Access JWT verification (`src/auth.ts`) |
| Authorization | Owner-scoped by verified email on every route |
| Secret storage | `OAuthClientDO` encryption under `MASTER_KEY` |
| Audit | Bridge receipts in `AUDIT_KV`, 90-day retention |
| Network egress | Outbound-only companion; SSRF and destination policy (`src/public-url.ts`) |
| Isolation | Per-owner container; Code Mode sandbox; sandboxed artifact iframe |

## Reporting A Vulnerability

Report a suspected vulnerability through GitHub's **Report a vulnerability** flow
under the repository's Security tab. Do not open a public issue for a suspected
vulnerability, a credential, a private deployment detail, or user data.

Include the affected revision, the reproduction steps, the impact, and any
suggested mitigation. Do not access data that is not yours while you validate a
report. Do not publish a working exploit before a fix is available.

Relevant reports include authentication or identity confusion, cross-user or
cross-machine tool routing, escape of an explicit working-directory or session
path, a missing audit receipt, leakage of a secret beyond a documented preview,
and a child-process cleanup or lifecycle bypass.

## Supported Versions

Security fixes target the current `main` branch. Older deployed revisions and
tags are not supported unless their release notes say otherwise. My AX is
self-hosted. The deploying owner is responsible for updating dependencies,
configuring Cloudflare Access, preserving encryption secrets, and applying
migrations.
