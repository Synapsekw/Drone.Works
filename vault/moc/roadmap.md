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
P0-04 canonical model complete
  -> P0-05 tenancy proof (local relational core complete)
  -> P0-06 telemetry proof complete; D-008 accepted
  -> P0-07 stack/provider/recovery closure (active)
  -> P0-08 threat-model closure
  -> P0-09 Phase 1A backlog
```

P0-03's core technical proof is complete and D-009 selects the native Rust CLI inside the Linux boundary. P0-04's generic model and P0-05's local relational tenancy/deletion evidence pass. P0-06 physically represented 600 million frames, accepted D-008's per-flight columnar-object layout, and documented provider-inclusive thresholds. P0-07 now owns the remaining stack, auth, job-fault, object-provider, deployment, recovery, observability, and cost choices. Broader fixture validation and production D-012 review remain permission/terms-gated.
