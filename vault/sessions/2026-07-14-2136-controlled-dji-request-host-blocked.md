---
type: session
date: 2026-07-14-2136
branch: main
trigger: wrapup
status: blocked
tags: [session, research/dji, security/isolation, privacy]
related: ["[[00-north-star]]", "[[research]]", "[[2026-07-14-2100-green-parser-ci-proof]]"]
---

# Prepare controlled DJI request

## What changed

- Added a one-shot keychain runner that defaults to no-network dry-run mode and requires an explicit live flag plus fixture authorization.
- Kept the development credential in the trusted parent, keychains in an encrypted process-lifetime cache, and decoding in a fresh no-network child with sanitized output.
- Corrected the finite feature-point allowlist to accept the parser's DJI wire identifiers and added regression tests.
- Recorded the first fixture's owner authorization and committed the implementation and canonical evidence as `f34a614`.
- Attempted the controlled live execution, but the host rejected external disclosure before the runner process started; no DJI request was made.

## Why

P0-03 needs representative decrypted frames before choosing the final parser/runtime boundary. The new runner makes that evidence path explicit and fail-closed without requiring Docker locally or exposing credentials to parser code.

## Verification

- Full parser suite outside the outer sandbox: 56 tests passed with zero skips or failures, including mock provider, credential isolation, cache destruction, and macOS network denial.
- Real-fixture dry run produced one bounded request with one group, nine allowlisted feature points, and 3,825 serialized bytes; no network or credential access occurred.
- Fixture verification passed for four local fixtures; `git diff --check` and the tracked-secret pattern scan passed.
- Vault verification passed for 22 notes before this wrap-up.
- Live execution did not start because the host external-disclosure control rejected it.

## Open threads

- Obtain explicit host approval for transmitting the authorized fixture-derived request to DJI, or run the reviewed one-shot command in a suitable trusted local environment.
- If retrieval succeeds, validate complete frames, truncated-record isolation, later-operation recovery, and representative resource/output measurements.
- Settle D-009 and the JS-binding-versus-Rust-CLI choice; production secret storage, notice/consent, retention, and deletion gates remain open under D-012.

## Next session entry point

Resume from `f34a614`. Execute the existing controlled runner for the first authorized fixture only after the host permits external disclosure, then record only sanitized broker/decode evidence and continue the truncation/recovery sequence.
