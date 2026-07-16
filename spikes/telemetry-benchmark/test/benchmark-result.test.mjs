import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("retained benchmark result satisfies the P0-06 evidence floor", async () => {
  const result = JSON.parse(await readFile(
    new URL("../results/benchmark.json", import.meta.url),
    "utf8",
  ));
  assert.equal(result.profile, "benchmark");
  assert.equal(result.dataset.organizations, 100);
  assert.equal(result.dataset.flights, 100_000);
  assert.equal(result.dataset.frames, 600_000_000);
  assert.equal(result.environment.postgres.fsync, "on");
  assert.equal(result.environment.postgres.full_page_writes, "on");

  const objectCandidate = result.candidates.find(
    (candidate) => candidate.candidate === "versioned_columnar_object_with_postgres_metadata",
  );
  const relationalCandidate = result.candidates.find(
    (candidate) => candidate.candidate === "postgres_partitioned_rows",
  );
  assert.equal(objectCandidate.measurement_scope.flights_actual, 100_000);
  assert.equal(objectCandidate.measurement_scope.frames_actual, 600_000_000);
  assert.equal(objectCandidate.retrieval.replay_points, 1_000);
  assert.equal(objectCandidate.retrieval.full_export_rows, 6_000);
  assert.ok(objectCandidate.retrieval.full_export_pages >= 3);
  assert.equal(objectCandidate.replay_summary_matches_full, true);
  assert.equal(objectCandidate.deletion.single_flight_deleted, 1);
  assert.equal(objectCandidate.deletion.organization_objects_after, 0);
  assert.equal(objectCandidate.capability_evolution.old_version, 1);
  assert.equal(objectCandidate.capability_evolution.new_version, 2);
  assert.equal(objectCandidate.capability_evolution.old_read_after_additive_change, true);

  assert.equal(relationalCandidate.measurement_scope.frames_actual, 6_000_000);
  assert.equal(relationalCandidate.measurement_scope.benchmark_frames_projected, 600_000_000);
  assert.equal(relationalCandidate.replay_summary_matches_full, true);
  assert.ok(
    relationalCandidate.storage.samples_bytes_projected_100k
      > objectCandidate.storage.object_bytes_actual * 20,
  );
});
