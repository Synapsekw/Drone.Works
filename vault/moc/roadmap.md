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
P0-03 parser/key feasibility
  -> native termination classification + release gates
  -> P0-04 canonical model
  -> P0-05 tenancy + P0-06 telemetry proofs
  -> P0-07/08 stack and threat-model closure
  -> P0-09 Phase 1A backlog
```

D-009 now selects a minimal native Rust CLI inside the proven Linux hard-container boundary. The next gate is exposing truthful parse termination (`truncated_records` versus corrupt/internal failure), then closing the native artifact SBOM/audit/attestation proof before P0-04 consumes a representative intermediate output.
