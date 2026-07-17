---
type: session
date: 2026-07-17-0704
branch: main
trigger: wrapup
status: blocked
tags: [session, roadmap/phase-1a, parser, containment]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-16-2326-a07-atomic-dispatch]]"
---

# Implement A08 parser supervision

## What changed

- Added a production parser package with a pinned Rust/source release manifest,
  minimal digest-pinned OCI image, target SBOM/notices/advisory verification,
  and binary/image attestation path.
- Added a content-addressed supervisor that rehashes the exact bounded source,
  revalidates rootless no-network containment, bounds private IPC and resources,
  classifies failures, clears private material, and reports cleanup failure.
- Added an exact one-use private intermediate validator plus eleven generated
  host tests for poison/panic recovery, time/output/memory/input limits,
  isolation weakening, cleanup, and floating-image denial.
- Added the hosted Linux production-image gate and parser promotion/rollback/
  alarm runbook; recorded the honest pending-CI state in canonical documents.
- Committed the implementation as `81717ec` without staging the unrelated
  Obsidian change.

## Why

A10 must receive a validated private intermediate without letting one corrupt or
adversarial source affect the worker, another parse, or the organization/data
boundaries already established by A04–A07. Promotion remains separate from local
simulation so the exact production Linux image cannot be approved on host tests
alone.

## Verification

- Frozen workspace install, `corepack pnpm verify`, `corepack pnpm build`, parser
  release verification, formatting, lint, strict types, package boundaries,
  source privacy, and Git whitespace checks passed; all eleven parser host tests
  and four API contract tests passed.
- The retained parser spike suite passed 68 tests with two sandbox-dependent
  localhost tests skipped. Each of two disposable exact native builds passed six
  Rust tests, and all 86 retained evidence files were byte-identical.
- The shipped 42-component target graph passed with zero RustSec vulnerabilities
  or warnings; four vulnerabilities and two warnings belonged only to excluded
  non-target lockfile packages.
- No Docker or compatible OCI runtime was available locally, nothing was pushed,
  and the new exact production image was not run in hosted Linux CI. No private
  fixture, customer data, Better Auth, DJI provider access, AWS/RDS resource, or
  credential was used.

## Open threads

- A08 is not complete until the committed change is available to the hosted
  workflow and its production OCI execution, retained Linux containment, exact
  digest verification, and attestations all pass.
- A09 provider/key or authorized unencrypted-format enablement remains an
  external gate; it must not be bypassed with an unsupported support claim.
- A13b verified Better Auth remains mandatory before A14, and AWS account/spend
  authority remains deferred. The unrelated `.obsidian/app.json` change remains
  unstaged and untouched.

## Next session entry point

Start by making commit `81717ec` available to the hosted Linux workflow without
changing its evidence inputs, inspect every A08 job, and mark A08 complete only
if the exact production image and containment/attestation gates pass. Then enter
A09; do not start normalization, provider access, Better Auth, or AWS early.
