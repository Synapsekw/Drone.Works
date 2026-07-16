---
type: moc
status: active
tags: [moc/roadmap]
related: ["[[00-north-star]]", "[[project-history]]"]
---

# Roadmap — Map of Content

- [Delivery plan](../../docs/roadmap/DELIVERY-PLAN.md) — Phase 0 through the private-pilot learning gate.
- [Phase 0 discovery](../../docs/roadmap/PHASE-0-DISCOVERY.md) — workstreams, dependencies, evidence gates, and stop conditions.
- [Phase 0 exit review](../../docs/roadmap/PHASE-0-EXIT-REVIEW.md) — completion evidence and safe external gates.
- [Phase 1A implementation backlog](../../docs/roadmap/PHASE-1A-BACKLOG.md) — seventeen ordered walking-skeleton tasks after the D-015 sequence revision.
- [Phase 1B outcome outline](../../docs/roadmap/PHASE-1B-OUTLINE.md) — bounded next-increment outcomes.
- [Delivery risk register](../../docs/roadmap/RISK-REGISTER.md) — owners, triggers, mitigations, and fallbacks.
- [[project-history]] — completed milestones backed by commits.

## Current critical path

```text
Phase 0 complete
  -> A01 production repository bootstrap (complete)
  -> A02 no-cloud local runtime (complete)
  -> A03 versioned API contract (complete)
  -> A04 PostgreSQL migration and forced-RLS boundary (complete)
  -> A05 local identity seam and app-owned authorization (complete)
  -> A06 immutable raw upload (complete)
  -> A07–A13a functional local application
  -> A13b verified auth and repeated end-to-end path
  -> A14 AWS staging
  -> continue the ordered Phase 1A vertical path
```

Resume at A07 using native PostgreSQL, generated personas, and the A06 loopback
object boundary. Add payload-free durable dispatch without starting parsing;
Better Auth waits for A13b and RDS waits for A14. Keep A09 DJI enablement plus
A14–A15 AWS hosted-data work fail-closed until their external authority and
evidence pass.
