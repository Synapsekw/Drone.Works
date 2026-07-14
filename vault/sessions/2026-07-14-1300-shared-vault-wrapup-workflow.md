---
type: session
date: 2026-07-14-1300
branch: main
trigger: wrapup
status: complete
tags: [session, vault/wrapup]
related: ["[[00-north-star]]", "[[memory]]", "[[2026-07-14-wrapup-protocol]]", "[[2026-07-14-1105-obsidian-vault-bootstrap]]"]
---

# Operationalize shared vault wrap-ups

## What changed

- Added the repository-local `$wrapup` Codex skill and its UI metadata under `.agents/skills/wrapup/`.
- Added a Claude Code `/wrapup` command that delegates to the same protocol instead of duplicating it.
- Added `scripts/wrapup-context.sh` to gather branch, upstream, working-tree, north-star, draft, and recent-session state in one deterministic call.
- Made the shared protocol mandatory after every substantial working block in `AGENTS.md` and documented the workflow decision in [[2026-07-14-wrapup-protocol]].
- Committed the reusable workflow as `a3be616` without staging the unrelated Obsidian plugin-state change.

## Why

A vault is useful only when updating it is part of normal delivery. The shared protocol turns project memory into an evidence-based end-of-session habit while keeping source changes, private fixtures, and editor state outside automatic memory commits.

## Verification

- `bash -n scripts/wrapup-context.sh` and a live `scripts/wrapup-context.sh` run passed.
- The skill and `agents/openai.yaml` passed an equivalent YAML/schema check. The skill-creator validator could not start because both available Python runtimes lack its `yaml` dependency.
- `node scripts/vault/verify.mjs`, `git diff --check -- vault/`, and the vault privacy scan passed after the north-star update.
- No product code changed; the parser suite was not rerun for this workflow-only change.

## Open threads

- `.obsidian/community-plugins.json` remains locally modified by Obsidian and was deliberately left unstaged; decide separately whether that plugin enablement belongs in shared configuration.
- The P0-03 Linux no-network parser container and CI/advisory gate remain the next technical delivery work.

## Next session entry point

Read [[00-north-star]] and [[research]], then implement the Linux parser-container proof and CI/advisory gate without contacting DJI. End that block with `$wrapup` so this workflow receives its first product-development use.
