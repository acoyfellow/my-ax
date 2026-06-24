# Repository standard for loop changes

A change should preserve the seven-minute repository: a new contributor can identify the product purpose, state owner, request path, change location, and verification command without reconstructing migration history.

For every touched boundary:

1. **One obvious owner and path** — do not introduce parallel current/legacy implementations or generic factories that hide authority.
2. **Less total complexity** — a new helper/file/abstraction must replace more complexity than it adds.
3. **Current truth** — names and comments describe present behavior and non-obvious invariants, not project phases or war stories.
4. **Bounded cleanup** — remove only code, exports, tests, dependencies, configuration, and docs made obsolete or misleading by the finding.
5. **Public safety** — source, tests, docs, and generated artifacts contain no deployment-specific identity, private hosts, credentials, secrets, or private history.
6. **Commands remain real** — contributor commands exist in `package.json`; generated outputs and dynamic imports are considered before deleting apparent dead code.

A final diff review should answer:

- Who owns this state after the change?
- Is there one request/execution path?
- What observable test protects it?
- What became dead or misleading?
- Could this be deleted or made more explicit?
