---
type: moc
status: active
tags: [moc/memory]
related: ["[[00-north-star]]", "[[project-history]]"]
---

# Memory — Map of Content

Drone.Works project memory has three layers:

## Layer 1 — Canonical project truth

- Product contract and decisions in `docs/product/`.
- Current code, tests, fixtures manifest, and generated research evidence.
- Architecture, roadmap, research, and testing documents in `docs/`.

## Layer 2 — Curated project continuity

- [[00-north-star]] — live snapshot and next action.
- [[project-history]] — milestone timeline.
- `vault/moc/` — navigation by concern.
- `vault/sessions/` — why work happened and where to resume.
- `vault/decisions/` — vault workflow decisions and non-product gotchas.

## Layer 3 — Tool-specific personal memory

Codex or other assistants may maintain machine-local preferences outside this repository. That layer is not project truth and must not contain the only copy of a Drone.Works decision or blocker.

## Capture policy

- Apply `.agents/skills/wrapup/SKILL.md` at the end of every substantial working block (`$wrapup` in Codex, `/wrapup` in Claude Code).
- Prefer links to canonical evidence over copying long passages.
- Record the reason, outcome, verification, open threads, and next entry point.
- Do not store private fixture values or secrets.
- Git history is the durable shared memory transport; Obsidian is the navigation and reading surface.
