# Flight-log fixture policy

Status: active for Phase 0
Last updated: 2026-07-19

## Purpose

Flight logs may contain precise routes, home locations, aircraft and battery serials, controller identifiers, account information, pilot names, warnings, and free text. This policy allows Drone.Works to test parsers without treating operational data as ordinary source code.

This policy is deliberately conservative. It is an engineering data-handling policy, not legal advice or a substitute for qualified review when licenses, employment, customer contracts, or privacy law are unclear.

## Non-negotiable rules

1. Do not collect or retain a log without a documented source and permitted use.
2. Do not commit a raw or derived log unless permanent repository redistribution is explicitly permitted.
3. Do not assume that owning an aircraft grants rights to employee, customer, or site data in its logs.
4. Do not edit raw bytes merely to make a log appear anonymous; encryption, checksums, offsets, or parser behavior may be changed.
5. Do not publish a log from a sensitive site, customer operation, private home, or restricted location.
6. Do not copy fixtures from proprietary products, support portals, forums, or datasets without explicit compatible redistribution terms.
7. Do not send a log or its metadata to DJI or another external service until the contributor has been informed and the flow is approved for that fixture.
8. A derivative inherits the parent's privacy and rights classification unless a documented review proves otherwise.

## Allowed provenance classes

### Owner-generated test flight

The contributor personally controlled the flight and has authority to provide the data. This is the preferred source.

It is still `local_only` by default. Repository redistribution requires separate explicit permission and a flight conducted at a deliberately non-sensitive test location.

### Contributor consent

A named rights holder provides the log for a stated purpose under written consent. Consent must cover who can access it, whether external key services may receive metadata, retention, and whether redistribution is allowed.

Revocable consent is suitable only for `local_only` storage. Git history and forks make reliable withdrawal of a committed file impractical.

### Public, compatible permission

A source provides explicit terms permitting the required commercial evaluation and, if applicable, repository redistribution. Record the exact source URL, license/permission version, and acquisition date.

Public accessibility alone is not permission.

### Synthetic derivative

A deterministic transformation is created from an allowed parent, such as a truncated or byte-corrupted sample for failure testing. Record the parent hash, transformation command or algorithm, and expected outcome.

Synthetic does not mean anonymous. A derivative inherits the parent's restrictions.

## Prohibited sources

- Logs obtained through unauthorized account, device, filesystem, or cloud access.
- Customer or employer logs provided without authority covering this project.
- Files scraped from forums, issue trackers, support attachments, or competing products without explicit compatible permission.
- Logs whose origin or rights holder cannot be established.
- Files that a contributor asks to be “anonymized later” before any safe handling agreement exists.
- Fixtures copied from proprietary or incompatible test suites.

## Storage classifications

### `local_only`

Use for real logs during research unless repository redistribution is clearly authorized.

- Store bytes only under `fixtures/local/` after initial review.
- Place unreviewed submissions under `fixtures/incoming/` for the shortest practical period.
- Both directories are ignored by Git.
- Store consent evidence under `fixtures/consent-records/` or an approved access-controlled system; never put personal consent records in the repository.
- The tracked manifest may contain non-sensitive metadata and a SHA-256 hash, but not precise coordinates, serials, account identifiers, names, or consent-document contents.
- Access is limited to people performing the documented evaluation.

### `repository`

Use only for fixtures safe and permitted for permanent distribution through Git history and forks.

- Store under `fixtures/repository/`.
- Written permission must explicitly allow repository redistribution and commercial product testing.
- Permission must not rely on later revocation to remove all historical copies.
- The flight must not expose a private home, customer site, restricted location, or unnecessary personal/device identifier.
- A second-person privacy and rights review is required before commit when the project has another qualified reviewer. Until then, record a self-review and flag the fixture for later independent review.

## Intake workflow

1. Receive the file into `fixtures/incoming/` without renaming it based on an assumed format.
2. Calculate SHA-256 before opening it in third-party applications or external services.
3. Record the rights basis and allowed use outside the raw file.
4. Identify sensitive-data categories without copying their values into the manifest.
5. Decide `local_only` or `repository`; uncertainty always resolves to `local_only`.
6. Assign a non-identifying fixture ID and storage filename.
7. Move it to the corresponding storage directory.
8. Add the manifest entry and run `node scripts/fixtures/verify-manifest.mjs`.
9. Only after approval may parser or external-key research use the file.

Do not use the filename extension as the format decision. `content_detection.status` remains `pending` until a content-based detector or parser probe provides evidence.

## Manifest privacy

The tracked manifest records only what is needed for reproducibility:

- non-identifying fixture ID;
- relative storage path;
- SHA-256 hash and byte length;
- broad provenance and permission class;
- source application/model/version when safe and known;
- encryption state and expected processing outcome;
- categories of sensitive data, never the values;
- parent hash and transformation for derivatives;
- review state and non-sensitive notes.

Do not record coordinates, takeoff place, customer, pilot name, email, account ID, aircraft serial, battery serial, controller serial, or original personal filename.

## Sanitization and derivatives

Raw fixtures remain byte-for-byte evidence. If sanitization is technically possible without invalidating the format, create a new derivative rather than overwriting the parent.

Every derivative must record:

- parent SHA-256;
- tool/command or algorithm version;
- parameters sufficient to reproduce it;
- new SHA-256 and byte length;
- expected parser outcome;
- confirmation that privacy and redistribution classification was re-reviewed.

Truncation and corruption derivatives normally retain route and identifier data from the parent. They do not become repository-safe automatically.

## External services and encrypted logs

Before transmitting any bytes or metadata to a key, weather, geocoding, malware-scanning, or analysis service:

- document exactly what is sent;
- record the provider and purpose;
- review terms, retention, logging, and regional processing;
- confirm the fixture permission covers the transmission;
- use the minimum data required;
- keep external service time and failure separate from parser measurements.

Until P0-03 approves the DJI key flow, no fixture is authorized for external DJI key retrieval merely by appearing in the manifest.

## Retention and withdrawal

### Local-only fixtures

- Record an expiry or review date when consent or purpose is time-limited.
- Delete bytes when permission expires, the contributor withdraws permission, the purpose ends, or the fixture is no longer needed.
- Remove or tombstone tracked metadata if retaining the hash or notes is no longer justified.
- Confirm deletion from local working copies and any approved shared research storage.

### Repository fixtures

- Do not promise full withdrawal from Git history or existing forks.
- If a safety or rights problem is discovered, remove the file from the active branch immediately, stop using it, and assess whether history rewrite and credential/privacy incident handling are necessary.
- Replace it with a safe fixture rather than weakening regression coverage silently.

## Review checklist

Before using any fixture:

- [ ] Provenance class is documented.
- [ ] Rights holder or public permission source is known.
- [ ] Commercial evaluation is permitted.
- [ ] Repository redistribution is either explicitly permitted or set to false.
- [ ] Sensitive-data categories are recorded without values.
- [ ] External-service permission is explicit or set to false.
- [ ] Storage path matches `local_only` or `repository` classification.
- [ ] SHA-256 and byte length match the file.
- [ ] Expected outcome is documented without relying on the extension.
- [ ] Expiry/review date is recorded where needed.
- [ ] Derivatives reference their parent and reproducible transformation.
- [ ] `node scripts/fixtures/verify-manifest.mjs` passes.

## Current Phase 0 state

Three contributor-provided DJI logs and one controlled truncated derivative are
inventoried as local-only fixtures. Their raw bytes remain ignored by Git and
all three source logs are encrypted DJI format version 14. The repository owner
has explicitly authorized bounded external processing only for the manifest row
used by the supported-format and A13a functional gates. Its request has passed
the one-shot research path and the generated local application path; neither
transmitted the raw log. External processing remains false for the other source
logs and derivative, and controlled derivatives inherit the parent restriction.

The handling, inventory, supported-parser, and narrow local functional uses are
satisfied for the approved row. No fixture is approved for redistribution,
hosted credentials, staging, production, or broader provider use.
