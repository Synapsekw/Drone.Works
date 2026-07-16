# Delivery risk register

Status: active
Last updated: 2026-07-16

| ID | Risk | Likelihood / impact | Owner | Current mitigation and trigger | Fallback / status |
|---|---|---|---|---|---|
| R-01 | DJI terms, notice/consent, or credential operations are unacceptable | Medium / Critical | product + qualified legal + security | D-012 provider remains disabled; A09 requires approval and full broker/cache/deletion gates | Obtain an authorized unencrypted supported variant or revise the supported promise; external gate open |
| R-02 | Current fixture set is too narrow for a commercially useful support claim | High / High | parser/product | lawful manifest, explicit single-variant matrix, no filename/version extrapolation; trigger on any claimed new variant | Keep matrix narrow and acquire owner/contributor fixtures with consent; open |
| R-03 | Live AWS S3 IAM/version behavior differs from loopback contract | Medium / Critical | storage/security | A15 temporary-bucket conformance, CloudTrail review, permanent version relist | Keep hosted customer upload disabled or change provider/adapter; Phase 1A gate |
| R-04 | Restore exceeds RTO or resurrects deleted data | Medium / Critical | recovery/deletion | 35-day max, independent receipts, isolated restore/replay, quarterly drills | Keep customer data disabled; improve automation, RDS shape, or Multi-AZ; Phase 1A gate |
| R-05 | Better Auth migration/security behavior weakens the boundary | Medium / High | auth/security | exact pin/lock, reviewed migration, provider-neutral adapter, real lifecycle/cookie tests | Replace behind adapter, including managed Clerk fallback; Phase 1A gate |
| R-06 | Parser dependency/source compromise or malformed input escapes containment | Medium / Critical | parser/release | source pin, reproducible build, SBOM/advisory/signature, fresh no-network resource-limited container | Disable affected variant/image and investigate; ongoing |
| R-07 | One EC2 host or Single-AZ RDS misses beta availability/recovery needs | Medium / High | platform/product | explicit no-SLA beta tradeoff, health/rebuild/restore drills, queue retry | Add second host/ALB and Multi-AZ when trigger fires; accepted beta risk |
| R-08 | Raw size, egress, logs, or DB class exceeds beta budget | Medium / Medium | platform/product | measured telemetry density, raw-size sensitivity, budgets/anomaly alerts, bounded logs/downloads | Reprice retention/egress transparently, resize, or pause expansion; ongoing |
| R-09 | Migration/query tooling removes RLS/grants or bypasses organization context | Low / Critical | database/security | start with `pg`+reviewed SQL, checksums, role/grant and isolation-digest tests | Block migration; repair forward; Drizzle remains deferred |
| R-10 | Transactional email or map provider leaks data or fails region/price needs | Medium / High | web/privacy/product | adapters, minimum email fields, route never sent to tiles, CSP/network tests, contract review | Choose alternate provider or local/provider-free experience; selection open |
| R-11 | UAE region conflicts with customer residency or missing service/provider support | Medium / High | product/platform | region is IaC input; reconfirm before spend/contract | Deploy accepted portable stack in approved region; external input open |
| R-12 | Duplicate/idempotency semantics create duplicate or lost flights | Medium / High | domain | source+normalized fingerprints, no probable auto-discard, idempotent job/transactions | Move ambiguity to Phase 1B review and keep both; ongoing |
| R-13 | Sensitive values enter logs/errors/support tools | Medium / Critical | observability/security | allowlisted structured fields, canaries, no free-form provider/parser payload, retention | Block release, purge affected sink where possible, rotate exposed secrets, incident process |
| R-14 | Small-team task scope expands into deferred Phase 1 features | High / Medium | product/engineering | task non-goals, API-first review, D-010, explicit Phase 1B outline | Split/reject scope and update decision before proceeding; ongoing |

Risks are reviewed at each milestone exit, after a failed gate or security
incident, before external spend/customer commitments, and whenever a
reconsideration trigger in D-008, D-009, D-013, or D-014 fires.

