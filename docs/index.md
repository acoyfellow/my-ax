# My AX Documentation

- [Deploying My AX](./deploy.md) — resource bootstrap, Access, persistence credentials, optional providers, updates, and rollback.
- [Local Development](./local-development.md) — loopback mode and an Access-gated tunnel for OAuth callbacks.
- [Architecture](./architecture.md) — request routing, Durable Objects, storage ownership, identity, and tool execution.
- [Feature Status and Limits](./feature-matrix.md) — shipped behavior and known boundaries.
- [Implementation Patterns](./patterns.md) — OAuth forwarding, tool discovery, Work Code Mode, workspace persistence, and attention.
- [Improvement Loop](../LOOP.md) — ten-minute reconciler and child/parent authority contract.
  - [Controller state](./loop/state-schema.md) — states, leases, fencing, callbacks, blockers, and crash recovery.
  - [Product direction](./loop/direction.md) — weekly bets, daily evidence ranking, metrics, and stop conditions.
  - [Release and rollback](./loop/release.md) — budgets, soak, proof, circuit breaker, and rollback record.
  - [Repository standard](./loop/repository-standard.md) — seven-minute repository rules for touched boundaries.
  - [Disagreement review](./loop/disagreement-review.md) — builder/skeptic/historian evidence review without voting.
- [Deployment Proof](../proof/README.md) — exact checks performed against a deployed Worker.
- [Security Policy](../SECURITY.md) — reporting and deployment-owner responsibilities.
- [Contributing](../CONTRIBUTING.md) — local checks and repository invariants.
