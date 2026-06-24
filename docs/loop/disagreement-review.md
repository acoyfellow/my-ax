# Disagreement review

Use typed disagreement when the loop is about to change process, architecture, release policy, or a risky user path.

The goal is not to collect opinions or votes. The goal is to split evidence collection into three different jobs, then let the parent synthesize only decision-changing deltas.

## Roles

- `builder` — strongest evidence-backed case that the plan/change is executable.
- `skeptic` — concrete failure modes, missing evidence, safety gaps, and unauditable claims.
- `historian` — relevant prior artifacts, local receipts, precedent, similarities, and differences.

Each role is read-only by default. Each child must return evidence, missing proof, and one recommendation.

## Parent rule

The parent must not vote or count children. It may accept only claims that cite one of:

- an attributable Terrarium run ID;
- a local path or URL;
- an explicit missing proof.

A synthesis is valid only if it changes the plan, narrows scope, retires the work, or names one bounded next action.

## Command

Plan a review:

```bash
npm run loop:disagree -- plan LOOP.md
```

Create a receipt after running the three children:

```bash
npm run loop:disagree -- receipt LOOP.md \
  --builder ter_... \
  --skeptic ter_... \
  --historian ter_...
```

Verify the receipt before using it as loop evidence:

```bash
npm run loop:disagree -- verify .context/runs/YYYY-MM-DD-loop-disagree-loop.md
```

The verifier is intentionally narrow. It checks that all three roles are attributable, the required synthesis sections exist, and obvious voting language is absent. It does not prove the child claims are true; the parent still owns evidence-backed synthesis.

## When to use

Use this for:

- loop contract changes;
- state-machine or lease changes;
- release or rollback policy changes;
- security-sensitive workflow changes;
- choosing whether a terminal loop should continue or retire.

Do not use this for every small bug fix. A normal one-child review is cheaper when the risk is local and the proof is obvious.

## Receipt source

This pattern was promoted from depth experiment 04:

```text
.context/runs/2026-06-24-depth-04-disagreement-not-voting-1.1.md
```

Experiment result: PASS. Builder/skeptic/historian roles produced decision-changing evidence without majority voting.
