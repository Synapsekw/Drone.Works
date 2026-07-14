# Repository instructions

These instructions apply to the entire Drone.Works repository.

## Project-memory vault

The entire repository is an Obsidian vault. Durable development memory lives under `vault/`; product and engineering truth remains under `docs/` and in the codebase.

At the start of a substantial task:

1. Run `scripts/vault-context.sh` for the current branch, recent commits, north-star snapshot, and latest sessions.
2. Read `vault/00-north-star.md`.
3. Read the relevant map in `vault/moc/`.
4. Read the most recent relevant notes in `vault/sessions/`.

The vault summarizes and links; it does not override canonical documents. If a vault note conflicts with an accepted product document or newer repository evidence, update the vault note.

At the end of every substantial working block, apply the repository-local wrap-up protocol in `.agents/skills/wrapup/SKILL.md`. In Codex it can be invoked as `$wrapup`; in Claude Code use `/wrapup`. The protocol must:

- create a concise `vault/sessions/YYYY-MM-DD-HHmm-short-slug.md` note from `vault/templates/session.md`;
- update the live `Now` section and `last-updated` value in `vault/00-north-star.md` when project state or the next action changed;
- record architecture and product decisions only in `docs/product/DECISIONS.md`; `vault/decisions/` is limited to project-memory workflow decisions and non-product gotchas;
- run `node scripts/vault/verify.mjs` before committing;
- commit only the vault files intentionally changed by the wrap-up and never sweep source or `.obsidian/` changes into that commit;
- never copy secrets, raw fixture values, private coordinates, feature-point values, or customer data into vault notes.

Obsidian Sync is not an approved storage path for this repository. Git is the durable shared store for tracked notes. The local-only fixture folders remain outside Git and must not be connected to another sync service without an explicit privacy review.

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
