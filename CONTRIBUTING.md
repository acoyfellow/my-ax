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

## Pull Requests

Keep pull requests focused. Include:

- the user-visible behavior;
- the trust boundary affected;
- an automated test, or the exact proof command, prerequisites, and expected result;
- migration and deployment notes when applicable.

Report security issues privately through GitHub's **Report a vulnerability** flow rather than a public issue.
