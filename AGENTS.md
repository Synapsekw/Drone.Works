# Repository instructions

These instructions apply to the entire Drone.Works repository.

## Read before changing the product

Read the following documents in order:

1. `docs/product/PRODUCT.md`
2. `docs/product/BEHAVIOR.md`
3. `docs/product/PHASE-1-ACCEPTANCE.md`
4. `docs/product/DECISIONS.md`

Treat them as the product contract. A narrow, recently accepted decision takes precedence over a broader older statement.

## Non-negotiable rules

- Keep Phase 1 within the accepted boundary in `PRODUCT.md`.
- Expose core domain behavior through the versioned API used by the first-party web application.
- Enforce organization isolation across storage, API operations, jobs, exports, logs, and downloads.
- Preserve the distinction between imported facts, derived values, and user overrides.
- Never silently discard probable duplicate flights or ambiguous asset matches.
- Keep raw sources immutable while retained and honor the documented deletion lifecycle.
- Do not copy or adapt proprietary or incompatible source code, schemas, fixtures, or customer logs.
- Do not commit secrets, private coordinates, real customer data, or undocumented binary fixtures.

## Change discipline

- Update `BEHAVIOR.md` for changes visible to users or integrations.
- Update `PHASE-1-ACCEPTANCE.md` when Phase 1 behavior changes.
- Record meaningful technical choices in `DECISIONS.md` before treating them as settled.
- Include tests proportional to the behavior and risk changed once implementation begins.
- Prefer focused changes and preserve unrelated work in the repository.
