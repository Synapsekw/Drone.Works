---
name: wrapup
description: Capture the end of a Drone.Works working block in the repository Obsidian vault, refresh the live north-star snapshot, verify vault integrity and privacy, and commit only the resulting vault changes. Use when the user says wrap up, wrapup, end the session, capture progress, update or bump the north star, prepare a handoff, or asks to make project memory current.
---

# Wrap up Drone.Works

Create a durable, evidence-based handoff without mixing unrelated source changes into the vault commit.

## Workflow

1. Run `scripts/wrapup-context.sh` once. Use its note ID, branch, HEAD, upstream state, working-tree split, current `Now` section, drafts, and latest sessions. Do not reconstruct those values with separate commands.
2. Inspect only the additional Git diff, log, tests, and canonical documents needed to describe this working block accurately. Reconcile the conversation against repository evidence; do not claim work, commits, pushes, or tests that the repository does not support.
3. Derive a three-to-six-word kebab-case slug and create `vault/sessions/<note-id>-<slug>.md` from `vault/templates/session.md`:
   - set `trigger: wrapup`;
   - use `status: complete` only when the working block achieved its intended outcome, otherwise use `blocked`;
   - capture three to six concrete `What changed` bullets;
   - explain why the work mattered in one to three sentences;
   - list the exact verification performed, including skipped or unavailable checks;
   - preserve real blockers and follow-ups under `Open threads`;
   - finish with a precise next-session entry point;
   - link `[[00-north-star]]`, the relevant MOC, and any decision or prior session needed for continuity.
4. Read `vault/00-north-star.md` directly immediately before editing it. Treat it as a concise live snapshot, not a changelog:
   - bump `last-updated` to the note ID;
   - overwrite stale `Now` bullets with the actual phase, branch, completed evidence, verification baseline, blockers, and next actions;
   - update `Delivery position` or `Workstream status` only when evidence changed their state;
   - replace the previous session link in frontmatter `related` with the new session instead of accumulating every session;
   - never add a dated activity log to the north star.
5. Route decisions correctly. Product and architecture decisions belong only in `docs/product/DECISIONS.md`. Add a note under `vault/decisions/` only for a project-memory workflow decision or a durable non-product gotcha. A wrap-up may link to a product decision, but must not invent one.
6. Fold any relevant `vault/sessions/_draft-*.md` into the new session note, then remove the folded draft. Leave unrelated drafts untouched.
7. Verify before committing:

   ```bash
   node scripts/vault/verify.mjs
   git diff --check -- vault/
   rg -n '/Users/|DJIFlightRecord_|keychainsArray|aesCiphertext' vault/ || true
   ```

   Investigate every privacy-scan match. Remove secrets, raw fixture values, private coordinates, identifiers, keychain material, customer data, and machine-specific paths rather than merely accepting the match.
8. Review `git status --short -- vault/` and `git diff --cached --name-only`. Stage only the session note, north-star update, and other vault files intentionally changed by this wrap-up. Never use `git add .`, `git add -A`, or stage `.obsidian/`, source, fixtures, or canonical docs.
9. Commit the vault-only change as `docs(vault): <slug> session and north-star bump`. If unrelated non-vault changes are already staged, stop and report that a safe vault-only commit is blocked. If the wrap-up produced no vault change, do not create an empty commit. Do not push unless the user explicitly asked.
10. Report the session-note path, commit hash when created, the north-star fields changed, verification result, and any source or Obsidian changes deliberately left untouched.

## Discipline

- Use `apply_patch` for vault edits.
- Preserve user work and unrelated dirty-tree changes.
- Keep the session note concise; detailed analysis belongs in canonical documentation.
- Keep imported facts, derived values, and user overrides distinct when describing product work.
- Never weaken the repository privacy rules to make verification pass.
- A blocked session is useful memory. Record the blocker honestly instead of forcing `complete`.
