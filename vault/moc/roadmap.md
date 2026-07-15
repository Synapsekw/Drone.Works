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
  -> representative intermediate output + remaining fixture gates
  -> P0-04 canonical model
  -> P0-05 tenancy + P0-06 telemetry proofs
  -> P0-07/08 stack and threat-model closure
  -> P0-09 Phase 1A backlog
```

D-009 selects a minimal native Rust CLI inside the proven Linux hard-container boundary. Controlled truncation and hosted Linux reproducibility, strict advisory, evidence upload, and binary/SBOM attestation now pass. The next gate is a privacy-safe representative intermediate output and its measurements before P0-04 consumes that contract; broader fixture validation remains permission-gated.
