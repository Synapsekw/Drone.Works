---
type: session
date: 2026-07-14-2021
branch: main
trigger: wrapup
status: blocked
tags: [session, research/dji, ci, operations]
related: ["[[00-north-star]]", "[[research]]", "[[2026-07-14-1905-hosted-runner-still-blocked]]"]
---

# Retry after plan upgrade

## What changed

- Dispatched fresh `DJI parser evidence` run `29349208680` after the reported GitHub plan upgrade.
- Confirmed that `parser-tests` briefly queued, then failed before runner assignment; both dependent jobs were skipped.
- Retrieved the check-run annotation, which identifies failed recent payments or an insufficient spending limit as the reason the job did not start.
- Left source and workflow files unchanged because no repository code executed.

## Why

The check annotation replaces the earlier inference from `runner_id: 0` with GitHub's explicit billing diagnosis. A plan upgrade alone has not yet restored hosted Actions access for this private repository.

## Verification

- Run `29349208680`: `parser-tests` failed with `runner_id: 0`, zero steps, and one failure annotation; `linux-containment` and `internal-parser-build` were skipped.
- Annotation: "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings".
- The organization Actions billing endpoint returned `404` for the current credential, so the active spending limit could not be inspected through the API.
- The checkout was otherwise clean and one vault-only commit ahead of `origin/main`; no parser, fixture, container, or DJI operation ran.

## Open threads

- In the owning account or organization, clear any failed-payment hold and set the Actions spending limit above zero; a plan upgrade is separate from this limit.
- Allow the billing change to propagate, then dispatch a fresh workflow run and require all three jobs to execute.
- Keep the Linux containment and CI checklist items open until the workflow produces real runner evidence.

## Next session entry point

Open run `29349208680` and confirm the Billing & plans warning is gone. Then dispatch `DJI parser evidence` again and monitor runner assignment before diagnosing any repository-level failure.
