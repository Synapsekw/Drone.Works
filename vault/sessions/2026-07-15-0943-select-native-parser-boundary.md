---
type: session
date: 2026-07-15-0943
branch: main
trigger: wrapup
status: complete
tags: [session, research/dji, security/isolation, performance]
related: ["[[00-north-star]]", "[[research]]", "[[2026-07-15-0820-authorized-dji-decode-recovery]]"]
---

# Select native parser boundary

## What changed

- Compared the JS/WASM and native Rust bindings using one authorized parent keychain response held only in memory.
- Confirmed both runtimes return the same 27,228 frames, validation flags, and declared capabilities.
- Added a reproducible minimal native CLI build that removes provider networking, accepts bounded keychain input over standard input, and emits sanitized output.
- Converted unchecked upstream decoder panics into structured `parser_internal_error` and proved a later fresh child still succeeds.
- Accepted D-009 with the native Rust CLI inside the proven Linux hard-container boundary and committed the source and canonical evidence as `58e42a7`.

## Why

The authorized comparison resolves the P0-03 runtime choice with measured evidence: native decoding used about 70 MB peak RSS instead of 410 MB and took about half the decode time. Source inspection also showed why truthful truncation classification needs a parser change rather than a wrapper guess.

## Verification

- Reproducible native build checked out the exact pinned upstream commit, removed provider-network dependencies, built a 901,664-byte release executable, and passed its forbidden-marker/dependency checks.
- The guarded valid → controlled derivative → valid sequence returned 27,228 frames on both valid operations; the derivative returned structured `parser_internal_error` with zero stderr.
- Full parser/orchestration suite outside the outer sandbox: 57 tests passed with zero skips or failures, including mock provider and macOS network-denial checks.
- Rust formatting, JavaScript syntax, `git diff --check`, and tracked privacy scans passed.

## Open threads

- Patch the parser to preserve clean record completion versus unexpected EOF/corrupt-record termination, then classify the controlled derivative without guessing.
- Add native target SBOM/notices, advisory audit, Linux artifact attestation, and CI execution.
- Validate duration, normalization, output volume, and the remaining fixture matrix; production D-012 legal, consent, secret-store, retention, and deletion gates remain open.

## Next session entry point

Resume from `58e42a7`. Add a pinned-source parser patch that exposes record termination reason, prove `truncated_records` on the controlled derivative and unchanged valid output, then close the native release gates before starting P0-04 normalization.
