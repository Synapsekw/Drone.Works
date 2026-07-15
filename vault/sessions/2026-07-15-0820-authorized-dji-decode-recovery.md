---
type: session
date: 2026-07-15-0820
branch: main
trigger: wrapup
status: complete
tags: [session, research/dji, security/isolation, performance]
related: ["[[00-north-star]]", "[[research]]", "[[2026-07-14-2136-controlled-dji-request-host-blocked]]"]
---

# Prove authorized DJI decode recovery

## What changed

- Executed the explicitly approved keychain request through the trusted broker and validated a bounded response without serializing credential or key material.
- Confirmed the 128 MB V8 old-space limit fails cleanly, then decoded the authorized v14 fixture successfully at 256 MB.
- Extended the runner to reuse one ephemeral parent keychain for authorized offline follow-up decodes in fresh no-network children.
- Proved valid → controlled truncation → valid isolation and recovery without sending derivative metadata to DJI.
- Recorded the sanitized correctness, capability, memory, timing, and recovery evidence in canonical research documents and committed it as `c7a8d40`.

## Why

P0-03 needed real authorized frame evidence before choosing the parser/runtime boundary. This run closes the first decode and recovery uncertainty while exposing a material JavaScript RSS requirement and a remaining generic truncation classification.

## Verification

- Full parser suite outside the outer sandbox: 57 tests passed with zero skips or failures, including offline follow-up authorization and macOS network denial.
- The broker fetched one validated response group for the authorized fixture; ordinary output contained only counts and sizes.
- The 256 MB child decoded 27,228 frames with monotonic time, bounded coordinates and battery values, and location, battery, signal, and attitude capabilities.
- Two successful observations used approximately 411–413 MB RSS and 143–176 MB JavaScript heap; frame decoding took approximately 421–528 ms.
- The controlled derivative failed independently and the later valid child reproduced 27,228 frames; four fixtures passed manifest verification and repository/vault checks passed.

## Open threads

- Replace generic `decode_failed` with defensible `truncated_records` classification for the controlled derivative.
- Compare the JavaScript binding against a Rust CLI boundary using the now-authorized decode evidence and settle D-009.
- Validate duration, remaining fixture coverage, key-retrieval timing, normalization, and output volume; production D-012 gates remain open.

## Next session entry point

Resume from `c7a8d40`. Use the authorized evidence to compare JS-binding and Rust-CLI resource boundaries, add a tested truncation classification, and settle the P0-03 runtime decision before beginning P0-04 normalization.
