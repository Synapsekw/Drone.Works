---
type: session
date: 2026-07-17-1203
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, normalization, ci]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-17-1155-a10-normalization-gate]]"
---

# Confirm hosted A10 evidence

## What changed

- Confirmed the branch-tip hosted workspace and native PostgreSQL verification
  passed after the A10 implementation and vault closeout reached `main`.
- Confirmed parser tests, both reproducible parser builds, production OCI proof,
  release checks, audits, evidence upload, and attestations passed for A10.
- Investigated one failed synthetic Linux memory-containment probe and verified
  its unchanged failed-job rerun passed; no source or gate weakening was needed.
- Kept the unrelated Obsidian state and two untracked source-name copies
  unstaged and untouched.

## Why

The initial A10 handoff predated its hosted workflows. This follow-up replaces
that provisional statement with terminal branch-tip evidence and leaves A11
unblocked.

## Verification

- Hosted `verify` run
  [29564777791](https://github.com/Synapsekw/Drone.Works/actions/runs/29564777791)
  passed workspace verify/build and all native PostgreSQL suites.
- Hosted `DJI parser evidence` run
  [29564633726](https://github.com/Synapsekw/Drone.Works/actions/runs/29564633726)
  passed all four jobs after the unchanged Linux-containment retry.
- Repository `HEAD` and `origin/main` both resolved to vault closeout commit
  `17f1bbc` before this evidence-only wrap-up.

## Open threads

- A11 remains next: expose organization-authorized flight summary and bounded
  track replay from A10's retained canonical revision and telemetry object.
- A13b verified authentication still gates A14; hosted provider credentials,
  managed keys, AWS/RDS, and later uploads remain off.

## Next session entry point

Start A11 from its backlog contract and use A10's persisted current revision and
versioned telemetry object as the only summary and replay source.
