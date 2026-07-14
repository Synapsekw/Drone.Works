---
type: vault-decision
date: 2026-07-14
status: accepted
tags: [vault/decision, workflow]
related: ["[[00-north-star]]", "[[memory]]"]
---

# Use one shared wrap-up protocol

## Decision

Use `.agents/skills/wrapup/SKILL.md` as the single end-of-session protocol for Drone.Works. Codex exposes it as `$wrapup`; Claude Code exposes a thin `/wrapup` command that delegates to the same file.

Every substantial completed or blocked working block must produce an evidence-based session note, refresh the north star when live state changed, run vault integrity and privacy checks, and create a vault-only commit. Source files, fixtures, and `.obsidian/` state remain outside that automatic commit.

## Why

A passive vault drifts. One shared, deterministic protocol makes project memory part of normal delivery while avoiding duplicated instructions and accidental source commits.

## Consequences

- `scripts/wrapup-context.sh` becomes the single context-gathering entry point for wrap-ups.
- The north star remains a current snapshot; session notes retain history.
- Git makes each memory update durable without granting automatic push authority.
