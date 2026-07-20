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
  -> A07 atomic outbox dispatch (complete)
  -> A08 parser supervisor (complete)
  -> A09 supported DJI/key gate (complete)
  -> A10 normalize and persist (complete)
  -> A11 flight summary and bounded replay (complete)
  -> A12 web vertical path (complete)
  -> A13a functional local application (complete)
  -> A13b verified auth and repeated end-to-end path (complete)
  -> A14 AWS staging
  -> continue the ordered Phase 1A vertical path
```

Resume at A14 only after AWS account, approved-region, and spend authority are
confirmed. Begin with the pre-provision region/service-health gate and reviewed
synthetic-only IaC. Preserve app-owned membership authorization, forced RLS,
`/api/v1/`, parser containment, provider-free replay, and fixture privacy; keep
customer uploads, real DJI keys, hosted credentials, and production data off
until their later gates pass.
