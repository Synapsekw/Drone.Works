# Phase 0 — Technical discovery plan

Status: proposed
Target timebox: 10–15 focused working days for one primary builder with AI assistance
Last updated: 2026-07-12

## Objective

Retire the technical and legal uncertainties that could invalidate the first Drone.Works vertical slice. Phase 0 produces evidence and accepted decisions, not production feature volume.

The critical path is:

```text
Fixture rights and inventory
        ↓
DJI parser and key feasibility
        ↓
Canonical model and failure taxonomy
        ↓
Tenancy and telemetry proofs
        ↓
Stack and deployment decisions
        ↓
Phase 1A implementation backlog
```

## Working rules

- Spikes are disposable unless they meet production standards deliberately.
- Experimental code lives under a clearly marked `spikes/` area or a short-lived branch.
- No real customer logs, precise private coordinates, credentials, or undocumented fixtures are committed.
- Each fixture has a provenance record and redistribution classification.
- Candidate technologies are evaluated against the product contract, not familiarity alone.
- Record negative results; a rejected approach is useful evidence.
- Timebox investigation. Unresolved blockers trigger a stop/go decision rather than indefinite research.

## Decision gates

| Gate | Question | Blocking? | Evidence required |
|---|---|---:|---|
| G0 | Can we legally obtain and use representative DJI fixtures? | Yes | Fixture policy and initial inventory |
| G1 | Can selected DJI variants be parsed and normalized reliably? | Yes | Harness results and structured failure samples |
| G2 | Can encrypted logs be supported under acceptable terms and operations? | Yes for encrypted variants | Documented key flow, terms review, and failure behavior |
| G3 | Can organization isolation be enforced by design? | Yes | Executable cross-tenant negative proof |
| G4 | Is telemetry storage viable for replay, export, deletion, and cost? | Yes | Reproducible benchmark report |
| G5 | Is there a coherent deployable stack for the walking skeleton? | Yes | Accepted decisions and architecture package |

Failure at G0 or G1 pauses the DJI-first implementation plan. The team must then explicitly choose whether to narrow supported variants, acquire better fixtures, replace the parser approach, or revise the Phase 1 product promise.

## Workstream P0-01 — Constraints and evaluation scorecard

### Outcome

Technology choices are evaluated against explicit Drone.Works needs rather than generic preference.

### Work

- Convert accepted behavior into architecture quality attributes.
- Rank criteria: tenant isolation, parser isolation, deletion, telemetry replay, operability, developer speed, deployment portability, and cost.
- Establish expected early scale and a larger benchmark scale without presenting either as a sales forecast.
- Record team skills, hosting constraints, budget constraints, and acceptable managed-service dependence.
- Define evidence and scoring rules before comparing candidates.

### Deliverables

- `docs/architecture/QUALITY-ATTRIBUTES.md`
- `docs/architecture/STACK-SCORECARD.md`

### Acceptance

- Each criterion has a weight, measurement method, and disqualifying condition where relevant.
- Product non-negotiables cannot be outweighed by convenience scoring.
- Unknowns are marked unknown rather than assigned optimistic scores.

### Dependencies

None. Start first.

## Workstream P0-02 — Fixture policy and supported-format inventory

### Outcome

The team has lawful, documented input data for parser evaluation and future regression tests.

### Work

- Define acceptable fixture sources: owner-generated test flights, explicit contributor consent, or redistribution-compatible public samples.
- Define sanitization rules without corrupting parser-relevant bytes.
- Separate locally held non-redistributable evaluation inputs from repository-safe fixtures.
- Inventory DJI application, aircraft model, format version, encrypted/plain, duration, and expected corruption class.
- Create metadata without recording unnecessary coordinates or personal identifiers.
- Document how contributors can provide a fixture and revoke permission where applicable.

### Deliverables

- `docs/testing/FIXTURE-POLICY.md`
- A fixture manifest containing hashes, provenance, allowed use, and expected classification.
- At least one valid candidate log and one safely produced corrupt/truncated derivative for the first supported variant.

### Acceptance

- Every evaluated file has a provenance and handling classification.
- Repository-safe and local-only fixtures cannot be confused by tooling or documentation.
- `.gitignore` prevents accidental commit of local-only logs.
- No fixture requires trusting a filename extension for classification.

### Dependencies

P0-01 informs privacy and portability criteria, but policy drafting can begin immediately.

## Workstream P0-03 — DJI parser and key feasibility

### Outcome

The team knows exactly which DJI variant can anchor Phase 1A and what operational risks accompany it.

### Work

- Verify candidate parser license, maintenance status, transitive dependencies, and supported format versions.
- Build a minimal harness that accepts bytes, detects format, invokes the parser, and emits a versioned intermediate representation or structured failure.
- Exercise valid, truncated, corrupt, unsupported, and encrypted inputs where lawfully available.
- Measure controlled CPU time, memory, and output volume separately from external key retrieval.
- Determine whether the parser can be interrupted safely and whether malformed data can crash or hang its process.
- Document the encrypted-log key request, transmitted metadata, cache key, cache lifetime, terms, rate limits, and outage behavior.
- Define the initial failure taxonomy, including unsupported format, unsupported version, corrupt input, missing key, key service unavailable, resource limit, and internal parser error.

### Deliverables

- Disposable parser harness and reproducible commands.
- `docs/research/DJI-PARSER-EVALUATION.md`
- Proposed supported DJI matrix for Phase 1A.
- Evidence supporting acceptance, rejection, or revision of D-009.
- A new decision entry for parser library and encrypted-key strategy if evidence is sufficient.

### Acceptance

- At least one valid candidate log produces deterministic intermediate output.
- Repeating the same parse produces the same material output and source hash.
- A corrupt input cannot prevent a subsequent valid parse.
- Every tested failure maps to a structured class without exposing sensitive file content.
- External key time is reported separately from controlled parse time.
- Licensing and key-service questions are documented; unresolved legal uncertainty remains blocking.

### Dependencies

Requires P0-02 inputs. This is the primary critical-path workstream.

## Workstream P0-04 — Canonical model and provenance proof

### Outcome

The selected parser output can become a canonical flight without losing source evidence or preventing future reprocessing.

### Work

- Model upload batch, raw source, import item, processing attempt, parser revision, canonical flight, telemetry frame/series, pilot, aircraft, battery, and asset identifier.
- Demonstrate that one file can yield zero, one, or multiple operational flights.
- Represent multi-battery flights and missing identifiers.
- Define imported, derived, user-override, and effective-value rules for important fields.
- Define timezone source, assumption, correction, and UTC conversion behavior.
- Draft capability names and versioning.
- Draft exact-file, exact-normalized, and probable-duplicate evidence without finalizing scoring thresholds.
- Trace reprocessing, reassignment, deletion, restoration, and asset merge through the model.

### Deliverables

- `docs/architecture/DOMAIN-MODEL.md`
- Domain relationship diagram.
- Example normalized representation generated from the Phase 1A fixture.
- Draft API resources for the walking skeleton.
- Identified changes, if any, required in the product contract.

### Acceptance

- Every important canonical field can identify its source or derivation.
- A user override survives a simulated parser revision.
- Reprocessing does not require a second canonical flight.
- Missing battery data is not represented as a fictional asset or zero value.
- Organization ownership and deletion behavior are explicit for every modeled resource.

### Dependencies

Begins after P0-03 has a representative intermediate output.

## Workstream P0-05 — Organization-isolation proof

### Outcome

The candidate data-access design makes cross-organization access difficult to express and easy to test.

### Work

- Evaluate the primary database and its tenant-isolation mechanisms.
- Create the smallest schema that demonstrates organizations, memberships, aircraft, flights, and telemetry ownership.
- Require explicit organization context in application access.
- Exercise direct-ID lookup, joins, aggregates, mutation, background-job lookup, and privileged maintenance paths.
- Define how object-storage keys and signed downloads bind to organization authorization.
- Define safe administrative and migration access without normalizing broad bypasses.

### Deliverables

- Executable isolation spike.
- `docs/architecture/TENANCY.md`
- Automated negative tests for Alpha-versus-Beta access.
- Evidence supporting acceptance or revision of D-002.

### Acceptance

- Cross-organization direct reads, joins, aggregates, and writes fail in automated tests.
- Missing organization context fails closed.
- A job cannot load a customer resource using only a globally supplied domain ID.
- The proposed object path and download flow require current authorization.
- Privileged bypass use is explicit, narrow, observable, and absent from ordinary request paths.

### Dependencies

Uses P0-01 criteria and the ownership model from P0-04. A minimal proof may begin earlier to compare database candidates.

## Workstream P0-06 — Telemetry storage and downsampling benchmark

### Outcome

Telemetry persistence is selected with evidence for import, replay, export, deletion, and early operating cost.

### Candidate families

- Relational rows with appropriate indexing/partitioning.
- A relational time-series extension.
- Object-backed columnar telemetry with relational metadata.

Candidates are examples, not predetermined finalists. A simpler option wins when it meets the product evidence.

### Work

- Define a reproducible synthetic dataset representing at least 100,000 flights across organizations, with documented frame rate and field sparsity assumptions.
- Keep synthetic tracks non-sensitive and clearly artificial.
- Benchmark ingest, time-window retrieval, default replay payload, bounded full export, single-flight deletion, and organization deletion.
- Implement or compare extrema-preserving downsampling that retains endpoints, important minima/maxima, and gaps.
- Estimate storage, request, backup, and egress cost for the defined dataset.
- Test how schema/capability evolution affects old records.

### Deliverables

- Reproducible benchmark generator and commands.
- Raw benchmark results retained as non-secret artifacts.
- `docs/research/TELEMETRY-BENCHMARK.md`
- Evidence supporting acceptance or revision of D-008.

### Acceptance

- Results state hardware/service tier, dataset assumptions, cold/warm conditions, and measurement boundaries.
- Default replay data preserves endpoints, material extrema, warnings, and gaps used by summary interpretation.
- Full telemetry access has a bounded delivery mechanism.
- Single-flight and organization deletion are demonstrated, not assumed.
- Cost estimate identifies the variables most likely to change the result.
- The selected design has explicit reconsideration thresholds.

### Dependencies

Uses P0-04 telemetry shape. It can proceed independently of the final web stack.

## Workstream P0-07 — Runtime, authentication, jobs, storage, and deployment selection

### Outcome

The walking skeleton has one coherent, operable stack with understood tradeoffs.

### Work

- Evaluate application/runtime candidates using the P0-01 scorecard.
- Select repository/package structure and schema/API contract approach.
- Evaluate authentication against multi-organization sessions, invite flow, account linking, local development, deletion, and provider portability.
- Evaluate background jobs against retries, idempotency, isolation, resource limits, scheduled deletion, and observability.
- Evaluate object storage against immutable uploads, lifecycle rules, signed downloads, local emulation, and deletion verification.
- Select deployment environments, secret handling, database migrations, preview policy, logs, metrics, tracing, backup, and rollback approach.
- Produce a rough monthly cost envelope for development, beta, and the defined benchmark scale.

### Deliverables

- Completed stack scorecard with evidence links.
- Accepted decision entries covering the selected stack and rejected alternatives.
- `docs/architecture/SYSTEM.md`
- `docs/architecture/SECURITY-BOUNDARIES.md`
- `docs/operations/ENVIRONMENTS.md`
- Local-development and deployment outline.

### Acceptance

- Each selected component has an owner, purpose, exit cost, and failure mode.
- Local development does not require production credentials or real customer data.
- The architecture supports the Phase 1A vertical path without implementing deferred features.
- Parser execution receives neither broad credentials nor unrestricted customer access.
- Backup, restore, deletion, migration, and rollback responsibilities are named.
- The estimated beta cost is visible and has alert thresholds.

### Dependencies

Uses evidence from P0-01 and preliminary results from P0-03 through P0-06. Final acceptance follows the critical proofs.

## Workstream P0-08 — Threat model and privacy flow

### Outcome

The walking skeleton addresses its highest-impact abuse cases before code patterns become entrenched.

### Work

- Map sensitive data: credentials, raw logs, coordinates, telemetry, serials, pilot identities, exports, audit metadata, and key-service requests.
- Trace upload, parsing, storage, replay, export, deletion, logging, backup, and external service flows.
- Identify threats involving tenant escape, signed-link leakage, malicious files, parser exhaustion, job replay, insecure direct-object reference, logs, support access, and dependency compromise.
- Define minimum controls and verification for Phase 1A.
- Separate engineering controls from legal policy or terms work requiring qualified review.

### Deliverables

- `docs/security/THREAT-MODEL.md`
- Data-flow diagram and trust boundaries.
- Phase 1A security acceptance checklist.
- Follow-up risks assigned to the appropriate delivery increment.

### Acceptance

- Every sensitive data class has an owner, purpose, storage location, access boundary, and deletion path.
- High-severity threats have prevention or detection controls in Phase 1A.
- Parser and external-key-service boundaries are explicit.
- Security work is embedded in delivery increments rather than deferred wholesale.

### Dependencies

Begins with P0-04 and closes after P0-07 defines the system boundary.

## Workstream P0-09 — Phase 1A implementation backlog

### Outcome

The next increment can be executed without reopening Phase 0 decisions in every task.

### Work

- Decompose the walking skeleton by end-to-end outcomes, not isolated technical layers.
- Include repository bootstrap, environments, observability, migrations, authentication, tenant context, upload, object storage, job execution, parser adapter, normalization, persistence, flight API, map page, and verification.
- Define fixture and test needs alongside each task.
- Identify a critical path and safe parallel work.
- Size tasks only after their dependencies and acceptance criteria are clear.

### Task template

Each task contains:

- **Outcome:** the verifiable result.
- **Scope:** work included.
- **Non-goals:** nearby work intentionally excluded.
- **Acceptance:** observable completion conditions.
- **Dependencies:** decisions, tasks, services, or fixtures required first.
- **Verification:** commands, tests, manual checks, and evidence.
- **Contract impact:** product, behavior, acceptance, or decision documents affected.
- **Operational impact:** migration, monitoring, rollback, deletion, or support considerations.

### Deliverables

- Ordered Phase 1A milestone and implementation-ready issue set.
- Phase 1B outcome outline without premature detailed estimates.
- Risk register with owners and revisit triggers.

### Acceptance

- Every task is independently reviewable and has objective completion evidence.
- The critical path begins with a runnable system and grows vertically.
- No task quietly introduces a deferred product capability.
- Security, tenancy, failure handling, and operations appear in the tasks that create the relevant behavior.

### Dependencies

Requires accepted or safely bounded outputs from P0-01 through P0-08.

## Suggested execution order

| Order | Work | Indicative timebox | Notes |
|---:|---|---:|---|
| 1 | P0-01 constraints and scorecard | 0.5–1 day | Establishes comparison rules |
| 2 | P0-02 fixture policy and inventory | 1 day | Begin immediately; external acquisition may take longer |
| 3 | P0-03 parser/key feasibility | 2–3 days | Primary critical-path spike |
| 4 | P0-04 canonical model proof | 1–2 days | Starts after representative parser output |
| 5 | P0-05 tenancy proof | 1–2 days | Can overlap model work cautiously |
| 6 | P0-06 telemetry benchmark | 2–3 days | Can run independently once shape is known |
| 7 | P0-07 stack and deployment selection | 1–2 days | Finalize after proof results |
| 8 | P0-08 threat model | 1 day | Develop throughout; close after architecture |
| 9 | P0-09 Phase 1A backlog | 1 day | Last output, based on accepted evidence |

The total is a focus estimate, not a promise. Fixture acquisition, encrypted-log terms, or external service access may extend elapsed time. Do not compress a blocking evidence gate to preserve the estimate.

## Phase 0 completion checklist

- [ ] Fixture policy and initial manifest exist.
- [ ] One Phase 1A DJI variant is supported by evidence.
- [ ] Corrupt/unsupported failure isolation is demonstrated.
- [ ] Encrypted-log strategy is accepted, explicitly excluded, or remains a named blocker.
- [ ] Canonical model and provenance rules are demonstrated with parser output.
- [ ] Organization-isolation negative tests pass.
- [ ] Telemetry benchmark and cost estimate are reproducible.
- [ ] Stack, authentication, jobs, object storage, and deployment decisions are accepted.
- [ ] Threat model and Phase 1A security checklist exist.
- [ ] Decision log reflects conclusions and rejected alternatives.
- [ ] Phase 1A issue set is ordered and implementation-ready.
- [ ] Product-contract changes discovered during research are reviewed explicitly.

## Stop conditions

Pause implementation and escalate the product decision if any of the following remains true at the end of the timebox:

- No legally usable representative DJI fixture can be obtained.
- No candidate parser reliably handles a commercially useful DJI variant.
- Encrypted-log support depends on unacceptable terms or unsafe credential handling and the unencrypted subset is not useful enough.
- Tenant isolation cannot be made fail-closed in the selected design.
- Telemetry cost or deletion behavior is incompatible with the intended product economics.
- The proposed stack requires production shortcuts that violate the accepted behavioral contract.

Stopping under these conditions is a successful discovery result. The next action is to revise the product promise or technical approach with evidence, not to build around the blocker silently.
