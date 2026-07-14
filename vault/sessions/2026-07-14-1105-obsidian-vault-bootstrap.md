---
type: session
date: 2026-07-14-1105
branch: main
trigger: user-request
status: complete
tags: [session, vault/bootstrap]
related: ["[[00-north-star]]", "[[project-history]]", "[[2026-07-14-repository-root-vault]]"]
---

# Connect Drone.Works project memory

## What changed

- Converted the active repository into an Obsidian-compatible vault with stable tracked settings and volatile UI state ignored.
- Added a north star, milestone history, concern maps, templates, a vault workflow decision, and a read-only context helper.
- Connected Codex and Claude bootstrap instructions to the same project-memory layer without changing the canonical product contract.
- Seeded current state from repository history through `d641e5f`, including P0-03 parser, keychain, isolation, and supply-chain evidence.

## Why

The project had strong canonical documentation but no concise, durable handoff layer. The repository-root vault keeps memory beside the evidence it describes and prevents a separate notes folder from drifting away from the build.

## Verification

- `scripts/vault-context.sh`
- `node scripts/vault/verify.mjs`
- Obsidian opens the repository root and displays `vault/00-north-star.md`.

## Open threads

- Keep Obsidian Sync disabled; private local fixtures are not approved for another storage path.
- Community plugins remain optional and are not required for the Markdown memory workflow.
- Next P0-03 work is the Linux parser container and CI/advisory gate, followed by the external key-retrieval decision.

## Next session entry point

Read [[00-north-star]] and [[research]], then implement the Linux no-network parser-container proof and CI build/advisory checks without contacting DJI.
