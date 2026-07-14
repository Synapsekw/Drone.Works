---
type: vault-decision
date: 2026-07-14
status: accepted
tags: [vault/decision, privacy]
related: ["[[00-north-star]]", "[[memory]]"]
---

# Use the active repository as the local Git-backed vault

## Context

Drone.Works needs durable development continuity. A separate empty Obsidian vault already existed on this workstation, while the active Git repository contained the actual product contract, research, and implementation evidence. The repository also has ignored local flight fixtures that must not silently enter another storage path.

## Decision

Open the active Git repository as the Obsidian vault and keep curated notes under `vault/`. Use Git as the durable shared transport for tracked notes. Do not connect this vault to Obsidian Sync unless a separate privacy review explicitly approves the folders and settings on every device.

## Rationale

One repository-root vault keeps code, canonical documentation, decisions, and session context in the same versioned history. It avoids drift between a memory vault and the code it describes. A local/Git-backed setup also preserves the existing boundary around private ignored fixtures.

## Consequences

- The previous empty vault remains untouched until this setup is verified.
- Stable `.obsidian` preferences may be tracked; workspace state, community-plugin activation, and downloaded plugin code remain machine-local and ignored.
- Vault notes must never duplicate raw fixtures, coordinates, credentials, or keychain material.
- Product and architecture decisions continue to live in `docs/product/DECISIONS.md`.
