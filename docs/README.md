# Drone.Works documentation

This directory contains the product and engineering documentation that governs Drone.Works.

For current project state and session continuity, start with [`../vault/00-north-star.md`](../vault/00-north-star.md). Vault notes link to this documentation but do not replace it.

## Product contract

Read these documents in order:

1. [`product/PRODUCT.md`](product/PRODUCT.md) defines the first customer, product promise, Phase 1 boundary, and success measures.
2. [`product/BEHAVIOR.md`](product/BEHAVIOR.md) defines observable behavior independently of implementation.
3. [`product/PHASE-1-ACCEPTANCE.md`](product/PHASE-1-ACCEPTANCE.md) turns critical behavior into acceptance scenarios and release gates.
4. [`product/DECISIONS.md`](product/DECISIONS.md) records accepted and proposed implementation decisions.

## Delivery roadmap

- [`roadmap/DELIVERY-PLAN.md`](roadmap/DELIVERY-PLAN.md) defines the evidence-gated path from discovery through the private pilot beta.
- [`roadmap/PHASE-0-DISCOVERY.md`](roadmap/PHASE-0-DISCOVERY.md) defines the immediate technical discovery work, decision gates, deliverables, and stop conditions.
- [`architecture/README.md`](architecture/README.md) indexes architecture evidence and designs as they are produced.
- [`operations/README.md`](operations/README.md) indexes environments, deployment, recovery, and cost policy.

## Testing and fixture governance

- [`testing/FIXTURE-POLICY.md`](testing/FIXTURE-POLICY.md) governs flight-log provenance, consent, privacy, storage, external processing, and redistribution.
- [`../fixtures/README.md`](../fixtures/README.md) documents the fixture manifest and verification workflow.

## Research

- [`research/DJI-PARSER-EVALUATION.md`](research/DJI-PARSER-EVALUATION.md) records the active parser feasibility investigation without publishing fixture contents.

## Precedence and change discipline

- A narrow, recently accepted decision takes precedence over a broader older statement.
- Behavior visible to users or integrations must be reflected in `BEHAVIOR.md`.
- A Phase 1 behavior change must update or add acceptance scenarios.
- Architecture choices must be recorded in `DECISIONS.md`; they do not belong in the behavioral specification unless users can observe them.
- Deferred roadmap ideas are not commitments and must not become Phase 1 requirements without an explicit product-scope decision.

Future engineering documentation should be grouped by purpose, for example `docs/architecture/`, `docs/api/`, and `docs/operations/`, rather than accumulated in the repository root.
