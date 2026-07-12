# Flight-log fixtures

Read [`../docs/testing/FIXTURE-POLICY.md`](../docs/testing/FIXTURE-POLICY.md) before placing any file here.

## Layout

```text
fixtures/
  manifest.json         tracked non-sensitive inventory
  manifest.schema.json  manifest contract
  repository/           permanently redistributable fixtures only
  incoming/             ignored, temporary unreviewed intake
  local/                ignored, reviewed local-only fixtures
  consent-records/      ignored, access-controlled evidence
```

The ignored directories do not exist in a clean checkout and should be created only when needed. Never bypass `.gitignore` with `git add -f` for a flight log.

## Commands

Verify the tracked manifest and every repository fixture:

```sh
node scripts/fixtures/verify-manifest.mjs
```

Also require every local-only file referenced by the manifest to exist:

```sh
node scripts/fixtures/verify-manifest.mjs --require-local
```

The default command permits missing local-only files so CI and contributors without private fixtures can still validate the repository. It never permits a missing `repository` fixture.

## Adding a fixture

1. Follow the policy intake workflow.
2. Copy the relevant object from `manifest.example.json` into `manifest.json`.
3. Replace all example values and remove fields that are not applicable.
4. Never put sensitive values into the manifest.
5. Run the verifier before using or committing the entry.

An empty manifest is valid while the project is waiting for an approved fixture.
