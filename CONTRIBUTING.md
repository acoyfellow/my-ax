# Contributing

Changes to the public engine must not require deployment-specific hosts, account IDs, connector catalogs, model routes, or secrets. Every persisted object and capability must remain scoped to the verified Access identity.

## Setup

```bash
npm ci
npm run check
npm run verify:public
```

Use Node.js 22+ and npm 11+. Local Sandbox work also needs Docker, Colima, or WSL2. See [`docs/local-development.md`](./docs/local-development.md).

## Before Opening a Pull Request

Run:

```bash
npm run check
npm run verify:public
npx wrangler deploy --dry-run --outdir /tmp/my-ax-worker

docker build -t my-ax-check .
```

`npm run check` rebuilds generated brand, vendor, CSS, and Svelte assets before typechecking and tests. Commit source changes, not ad-hoc edits to generated output.

## Boundaries

- Do not commit deployment-specific hosts, account IDs, Access settings, connector catalogs, model gateway routes, or secrets.
- Keep organization configuration in a private deployment wrapper.
- Treat Cloudflare Access identity as the owner principal; every durable row, object, upload, credential, and tool call must remain owner-scoped.
- New computer operations belong behind `work_search` and `work_code`, not as additional eager model tools.
- Durable Object migrations are append-only deployment history. Never rewrite or reuse an existing migration tag.
- Public URLs, redirects, and connector endpoints must pass the repository's SSRF and destination policies.
- Consequential actions need explicit server-side authorization; Code Mode isolation does not reduce the authority of an injected capability.

## Issues, then pull requests

File one issue first. Title it `bug:`, `perf:`, or `test:`. The body needs a receipt: a command and its output, a file and line, or a live URL. Do not file a second finding in the same issue.

A live client or server error may open that issue through `POST /api/errors`. One fingerprint is one issue for 24 hours. The body has no `triage:draft`. A human adds that after a head branch exists.

A GitHub webhook classifies `issues.opened`. The Worker comments and labels. A 15-minute sweep closes same-fingerprint duplicates and parks labeled issues that have no head and no new `triage:draft` comment. The Worker does not merge.

If a new comment contains `triage:draft` and a branch `bot/issue-<number>` already exists, the Worker may open a **ready** pull request (`draft: false`). The PR body must include `Closes #<n>` and a proof command. It must not invent a Files list. Review and audit comment `neverMerge: true`. A human merges.

Hunt-only work follows [agents/HUNT.md](./agents/HUNT.md): find one new issue, file it, stop. Do not open a PR from a hunt tick.

Push the branch **before** you write `triage:draft` on a new comment. If the head is missing, triage comments and no PR appears.

## Pull Requests

Keep pull requests focused. Include:

- the user-visible behavior;
- the trust boundary affected;
- an automated test, or the exact proof command, prerequisites, and expected result;
- migration and deployment notes when applicable.

Report security issues privately through GitHub's **Report a vulnerability** flow rather than a public issue.
