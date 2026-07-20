# Phase 1B outcome outline — Trustworthy imports

Status: active locally under D-016
Last updated: 2026-07-20

Phase 1B turns the single-file walking skeleton into a workflow where a team can
upload a real batch and understand or resolve every file outcome without silent
loss. Detailed issue sizing waits for Phase 1A evidence.

## Outcome slices

1. **Batch truth:** batch upload, per-file progress, content-based format
   detection, processing attempts, safe retry, and summaries that account for
   every input.
2. **Duplicate truth:** exact-source and exact-normalized idempotency plus
   probable-duplicate review that never silently discards a candidate.
3. **Asset and pilot reconciliation:** reliable serial matching, visible reasons,
   multi-battery/unknown-battery behavior, uploader-as-proposal only, and
   manager-controlled resolution.
4. **Time and capability reconciliation:** explicit timezone assumptions,
   supported/missing telemetry capabilities, preserved source values, and no
   missing measurement represented as zero.
5. **Reprocessing:** versioned parser/model attempts, deterministic fingerprints,
   active-revision transition, and user overrides that survive parser
   improvement.
6. **Clarity and learning:** actionable supported/unsupported/corrupt/truncated/
   key failure taxonomy, audited automated/reviewer reasons, expanded lawful
   fixture matrix, and usability sessions with people who did not build the
   parser.

LP02 implements the first local vertical through batch truth, public attempt
history, bounded recent-batch reads, retry eligibility, and exact/probable
duplicate presentation. It does not close duplicate resolution, asset/pilot/
timezone reconciliation, reprocessing, fixture expansion, usability learning,
or the Phase 1B exit gate.

## Entry gate

- Phase 1A local and deployed non-production exit reports pass.
- The selected DJI/key path is legally and operationally usable for the variants
  Phase 1B claims.
- Parser/resource/error and import-state metrics are trustworthy enough to
  measure batch outcomes.
- The Phase 1B fixture expansion follows `FIXTURE-POLICY.md`; no customer log is
  repurposed casually.

## Exit gate

- Relevant Phase 1 acceptance scenarios for batches, detection, duplicates,
  pilot/asset/timezone review, multi-battery, failure isolation, and reprocessing
  pass at API and UI boundaries.
- Every input has an explained terminal or waiting state; failed work cannot
  interrupt peer items.
- Supported valid fixtures meet the current completion target, and all automated
  match/review reasons are auditable without copying sensitive payload into logs.
- Representative operators can explain every batch result in usability review.

## Explicit non-goals

Phase 1B does not add manual entry, full logbook search/filter, complete replay
charts, bulk flight operations, exports, maintenance, billing, public API keys,
or webhooks. Those remain in their accepted later increments.
