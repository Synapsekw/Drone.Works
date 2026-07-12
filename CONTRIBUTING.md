# Contributing to Drone.Works

Thank you for helping build Drone.Works. The project is currently documentation-first: product behavior is being made precise before implementation begins.

## Before making a change

1. Read the [documentation index](docs/README.md).
2. Check the [decision log](docs/product/DECISIONS.md) for an existing decision or open question.
3. Keep the change focused. Avoid combining product behavior, architecture, and unrelated cleanup in one pull request.
4. Do not add copied or derived proprietary source code. New dependencies and fixtures require clear provenance and compatible usage terms.

## Product and documentation changes

- Update `PRODUCT.md` when the target customer, product promise, release boundary, or success measures change.
- Update `BEHAVIOR.md` when a user or integration can observe the change.
- Update `PHASE-1-ACCEPTANCE.md` whenever Phase 1 behavior changes.
- Add or supersede an entry in `DECISIONS.md` for meaningful technical choices.
- Write requirements in observable language and avoid committing to implementation details without evidence.

## Implementation changes

Implementation conventions will be expanded after the initial stack is selected. Until then:

- include tests proportional to the behavior and risk changed;
- preserve organization isolation at every storage, API, job, export, and download boundary;
- make import failures explicit and independently recoverable;
- do not silently replace user overrides during reprocessing;
- update public documentation in the same pull request as behavior changes.

## Commits

Use concise imperative commit subjects. Conventional Commit prefixes are encouraged:

- `feat:` user-visible capability;
- `fix:` defect correction;
- `docs:` documentation-only change;
- `test:` test-only change;
- `refactor:` internal change with no intended behavior change;
- `chore:` tooling or maintenance.

## Pull requests

A pull request should explain the problem, the chosen approach, how it was verified, and any behavior or decision documents changed. Keep secrets, customer logs, private coordinates, and proprietary samples out of commits and pull-request discussions.
