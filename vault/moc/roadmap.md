---
type: moc
status: active
tags: [moc/roadmap]
related: ["[[00-north-star]]", "[[project-history]]"]
---

# Roadmap — Map of Content

- [Delivery plan](../../docs/roadmap/DELIVERY-PLAN.md) — Phase 0 through the private-pilot learning gate.
- [Phase 0 discovery](../../docs/roadmap/PHASE-0-DISCOVERY.md) — workstreams, dependencies, evidence gates, and stop conditions.
- [[project-history]] — completed milestones backed by commits.

## Current critical path

```text
P0-04 canonical model
  -> generic schema + exact-normalized fingerprint + lifecycle transitions
  -> P0-05 tenancy + P0-06 telemetry proofs
  -> P0-07/08 stack and threat-model closure
  -> P0-09 Phase 1A backlog
```

P0-03's core technical proof is complete: D-009 selects a minimal native Rust CLI inside the proven Linux boundary, and private intermediate evidence passes. P0-04 now has its first canonical-v1 adapter, ownership model, representative normalization, and override-preservation proof. Finish the generic schema, exact-normalized fingerprint, and lifecycle transitions before starting the dependent P0-05/P0-06 proofs; broader fixture validation remains permission-gated.
