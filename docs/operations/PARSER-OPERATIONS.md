# Parser release and operations

Status: Phase 1A implementation baseline
Last updated: 2026-07-17

## Promotion gate

The native parser is released independently from the trusted Node worker. A
candidate is promotable only when the `DJI parser evidence` workflow passes all
of these checks on the committed change:

1. build the pinned Rust source twice for the declared Linux target and compare
   every retained artifact;
2. verify the reviewed source inputs, exact native digest, target SBOM, notices,
   and target-only RustSec policy;
3. build the minimal parser image from the digest-pinned distroless base and the
   verified native binary only;
4. run the host suite, exact production-image smoke, and retained Linux boundary
   suite for poison isolation, later-operation recovery, no network, read-only
   filesystems, PID, CPU, memory, temporary storage, wall time, and output caps;
5. attest the native binary provenance and SBOM and the exported OCI image.

Promotion records and deploys the resulting image digest, never a mutable tag.
Pull requests may build and test candidates but do not publish release
attestations. A locally built or host-simulated image is not promotable evidence.

## Runtime signals and alarms

Allowed parser signals are outcome code, wall-time bucket, input/output byte
bucket, CPU/memory limit profile, retry count, and aggregate counts. An opaque
job correlation ID may connect worker and parser events. Do not emit source or
intermediate hashes to metrics/logs, even though content digests may exist in a
private in-process summary. Stderr, filenames, object keys, source bytes,
telemetry, coordinates, serials, names, keychains, and provider material are
forbidden.

Alert immediately on any boundary-validation failure, invalid successful output,
image/source identity mismatch, or parser process that survives cleanup. Alert
on any OOM or output-limit event during the initial walking skeleton, and on a
sustained timeout or panic rate above 1% of attempts over 15 minutes once normal
traffic exists. Queue-age and retry/dead-letter alarms remain owned by the A07
worker boundary. Invalid, unsupported, corrupt, and truncated inputs are product
outcomes rather than infrastructure incidents unless their rate changes
materially.

## Failure, rollback, and upgrade

If the parser digest or containment gate fails, stop parser promotion and leave
the worker/API deploy unchanged. If a promoted parser regresses, disable new
claims, let in-flight containers terminate at their hard limits, and restore the
previous attested digest compatible with the same intermediate schema. Never
retry by weakening isolation or accepting unvalidated output.

Every source, Rust toolchain, dependency, base image, resource-envelope, native
wrapper, or intermediate-schema change requires fresh legal/license review as
applicable, two-build comparison, SBOM/notices, target-only advisory review,
host tests, production OCI execution, retained Linux containment, and new
attestations. A schema change must be additive or versioned and remain readable
by the deployed worker during rollback. Representative-fixture support and DJI
provider/key enablement are separate A09 gates.
