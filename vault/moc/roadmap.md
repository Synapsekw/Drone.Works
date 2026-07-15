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
  -> P0-05 tenancy proof (active; relational core complete)
  -> P0-06 telemetry proof
  -> P0-07/08 stack and threat-model closure
  -> P0-09 Phase 1A backlog
```

P0-03's core technical proof is complete: D-009 selects a minimal native Rust CLI inside the proven Linux boundary, and private intermediate evidence passes. P0-04 is source-free complete with its generic schema/validator and lifecycle proof. P0-05 now has native PostgreSQL forced-RLS, composite ownership, pooled-context, repository, job, aggregate, relational-export, derived-object-key, bounded-download, uniform-denial, and membership-revocation evidence; continue with a real queue, full API roles, a real object provider, privileged access, remaining resource types, and deletion. P0-06 can consume the versioned telemetry shape. Broader fixture validation remains permission-gated.
