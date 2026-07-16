---
type: vault-decision
date: 2026-07-16
status: accepted
tags: [vault/decision, gotcha/aws, operations/region]
related:
  - "[[00-north-star]]"
  - "[[2026-07-16-2005-phase-1a-foundation]]"
---

# Treat cloud region readiness as a live gate

> Product and architecture policy is canonical in D-014. This note records the
> recurring operational gotcha and the preferred assistance style.

## Context

An AWS region can appear in service catalogs while current operational or
account-specific conditions make it unsuitable. The project owner is building
their first cloud-backed product and needs cloud actions explained without
being asked to infer security, cost, or rollback consequences.

## Decision

Before any AWS provisioning, check current public/account health and required
service availability for the exact target region. Treat Frankfurt as
synthetic-only staging while UAE is not operationally suitable; never assume
Bahrain is a safe fallback without an independent check. Customer data remains
disabled outside an explicitly approved residency.

When user action is required, give one step at a time and include: why the step
is needed, what it changes, likely cost/security effect, how to verify success,
and how to stop or roll it back safely. Ask the user to confirm outcomes, never
to paste passwords, access keys, tokens, or database secrets.

## Rationale

IaC keeps the region replaceable, but it cannot make live availability or data
residency a static assumption. A consistent first-time-builder checklist
reduces accidental spend, insecure console configuration, and secret sharing.

## Consequences

- Positive: hosted work begins only with current evidence and clear owner
  understanding.
- Negative: A14 may pause for a health, account, service, cost, or residency
  decision even when application work is ready.
- Follow-up: re-check at A14 and record only the selected region and sanitized
  outcome; do not put account identifiers, secrets, or health payloads here.
