---
type: moc
status: active
tags: [vault/meta]
---

# Drone.Works project memory

The whole Drone.Works repository is the Obsidian vault. This `vault/` directory is the curated development-memory layer: where the project is now, why the current direction exists, what happened in each substantial work session, and where the next session should begin.

The codebase and `docs/` explain what Drone.Works is and how it must behave. Vault notes provide navigation and continuity; they never supersede canonical product, acceptance, architecture, research, or test evidence.

## Start here

Open [[00-north-star]] first, then use the relevant map under `vault/moc/`.

## Layout

- `00-north-star.md` — concise live state and next action.
- `project-history.md` — milestone timeline backed by Git commits.
- `moc/` — maps for product, architecture, roadmap, research, operations, and memory.
- `sessions/` — working-block summaries and handoffs.
- `decisions/` — vault-workflow decisions and non-product gotchas only.
- `templates/` — static templates that work without community plugins.
- `_attachments/` — images and files intentionally added to notes.

## Source-of-truth order

1. Accepted product behavior and decisions in `docs/product/`.
2. Current repository code, tests, manifests, and generated evidence.
3. Architecture, roadmap, research, and testing documents under `docs/`.
4. The north-star snapshot and session notes under `vault/`.

When a lower layer conflicts with a higher layer, correct the lower layer instead of preserving the contradiction.

## Working rules

1. Run `scripts/vault-context.sh` at the start of substantial work.
2. Run `$wrapup` in Codex or `/wrapup` in Claude after every substantial completed or blocked working block.
3. Keep session notes concise; detailed analysis belongs in a canonical document.
4. Update `00-north-star.md` only when the live state or next entry point changes. It is a snapshot, not a changelog.
5. Record technical/product decisions in `docs/product/DECISIONS.md`, not twice.
6. Run `node scripts/vault/verify.mjs` after vault edits.
7. Never place secrets, raw log values, private coordinates, customer data, or DJI keychain material in a note.

The shared protocol lives at `.agents/skills/wrapup/SKILL.md`; `scripts/wrapup-context.sh` provides its deterministic context snapshot. A wrap-up updates the live north star, verifies the vault, and creates a vault-only commit without staging source or Obsidian state.

## Obsidian configuration

Stable editor and template-path settings are tracked under `.obsidian/`. Workspace layout, graph state, plugin binaries, and other machine-local churn are ignored.

The vault deliberately requires no community plugin. Dataview, Templater, and Homepage may be evaluated later, but memory must remain usable as ordinary Markdown.

Obsidian Sync is intentionally not part of this setup. Git is the shared durable store for tracked notes, while the ignored local fixture directories remain private and local.
