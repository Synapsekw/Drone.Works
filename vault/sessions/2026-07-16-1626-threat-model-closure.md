---
type: session
date: 2026-07-16-1626
branch: main
trigger: wrapup
status: complete
tags: [session, security/threat-model, privacy/data-flow, roadmap/p0-08]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1622-deployment-stack-acceptance]]"
---

# Close the threat model

## What changed

- Mapped the walking-skeleton data flow and trust boundaries from browser/auth through RLS, objects, jobs, parser, observability, backups, deletion receipts, and restore.
- Assigned purpose, accountable owner, storage/retention, access boundary, and deletion path to twelve sensitive data classes.
- Rated seventeen critical/high abuse cases and attached prevention, detection, objective verification, and a named engineering owner to each.
- Added the blocking Phase 1A checklist for every change, staging, hosted customer data, DJI enablement, and beta release; committed P0-08 as `b093f35`.

## Why

Security work is now attached to the tasks that create each boundary instead of being deferred as a later hardening phase. External legal/provider uncertainty remains explicit and keeps only the affected boundary disabled.

## Verification

- Checked that every P0-08 sensitive class and required abuse case has a lifecycle and control owner.
- Checked critical/high coverage for tenancy, auth, parser escape, key leakage, deletion/restore, migration privilege, signed links, jobs, objects, logging, supply chain, browser, SSRF, availability/cost, maps, and provenance.
- Ran Git whitespace and privacy-pattern checks; canonical links resolve within the repository structure.
- No Docker, cloud credential, customer data, fixture content, provider call, or legal conclusion was used. The unrelated `.obsidian/app.json` change remained unstaged and untouched.

## Open threads

- Complete P0-09 with an ordered, implementation-ready Phase 1A issue set, critical path, Phase 1B outline, and risk register.
- Reconcile the Phase 0 checklist and distinguish completion from the safe external gates that keep hosted data or DJI processing disabled.

## Next session entry point

Resume from `b093f35` plus this vault-only closeout. Create the P0-09 backlog from the accepted architecture/security gates, starting with a runnable no-cloud system and growing one end-to-end slice at a time.

