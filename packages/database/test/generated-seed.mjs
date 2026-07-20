export const generatedOrganizations = Object.freeze({
  alpha: Object.freeze({
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    userId: '00000000-0000-4000-8000-0000000000a2',
    pilotId: '00000000-0000-4000-8000-0000000000a3',
    aircraftId: '00000000-0000-4000-8000-0000000000a4',
    aircraftIdentifierId: '00000000-0000-4000-8000-0000000000a0',
    rawSourceId: '00000000-0000-4000-8000-0000000000a5',
    rawObjectRevisionId: '00000000-0000-4000-8000-0000000000a6',
    batchId: '00000000-0000-4000-8000-0000000000a7',
    itemId: '00000000-0000-4000-8000-0000000000a8',
    attemptId: '00000000-0000-4000-8000-0000000000a9',
    flightId: '00000000-0000-4000-8000-0000000000aa',
    revisionId: '00000000-0000-4000-8000-0000000000ab',
    telemetryId: '00000000-0000-4000-8000-0000000000ac',
    telemetryObjectRevisionId: '00000000-0000-4000-8000-0000000000ad',
    auditId: '00000000-0000-4000-8000-0000000000ae',
    outboxId: '00000000-0000-4000-8000-0000000000af',
    invitationId: '10000000-0000-4000-8000-0000000000a1',
    marker: 'a',
  }),
  beta: Object.freeze({
    organizationId: '00000000-0000-4000-8000-0000000000b1',
    userId: '00000000-0000-4000-8000-0000000000b2',
    pilotId: '00000000-0000-4000-8000-0000000000b3',
    aircraftId: '00000000-0000-4000-8000-0000000000b4',
    aircraftIdentifierId: '00000000-0000-4000-8000-0000000000b0',
    rawSourceId: '00000000-0000-4000-8000-0000000000b5',
    rawObjectRevisionId: '00000000-0000-4000-8000-0000000000b6',
    batchId: '00000000-0000-4000-8000-0000000000b7',
    itemId: '00000000-0000-4000-8000-0000000000b8',
    attemptId: '00000000-0000-4000-8000-0000000000b9',
    flightId: '00000000-0000-4000-8000-0000000000ba',
    revisionId: '00000000-0000-4000-8000-0000000000bb',
    telemetryId: '00000000-0000-4000-8000-0000000000bc',
    telemetryObjectRevisionId: '00000000-0000-4000-8000-0000000000bd',
    auditId: '00000000-0000-4000-8000-0000000000be',
    outboxId: '00000000-0000-4000-8000-0000000000bf',
    invitationId: '10000000-0000-4000-8000-0000000000b1',
    marker: 'b',
  }),
});

export async function seedOrganization(transaction, seed) {
  const now = `2026-07-16T0${seed.marker === 'a' ? '1' : '2'}:00:00.000Z`;
  await transaction.query(
    `INSERT INTO droneworks.organizations (
       id, name, default_timezone, unit_system, created_at
     ) VALUES ($1, $2, 'Asia/Dubai', 'metric', $3)`,
    [seed.organizationId, `Generated ${seed.marker.toUpperCase()}`, now],
  );
  await transaction.query(
    `INSERT INTO droneworks.memberships (
       organization_id, user_id, role, created_at
     ) VALUES ($1, $2, 'owner', $3)`,
    [seed.organizationId, seed.userId, now],
  );
  await transaction.query(
    `INSERT INTO droneworks.invitations (
       organization_id, id, email_normalized, role, token_sha256,
       created_by_user_id, created_at, expires_at
     ) VALUES ($1, $2, $3, 'viewer', $4, $5, $6, $6::timestamptz + interval '1 day')`,
    [
      seed.organizationId,
      seed.invitationId,
      `generated-invite-${seed.marker}@example.test`,
      (seed.marker === 'a' ? '7' : '8').repeat(64),
      seed.userId,
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.pilot_profiles (
       organization_id, id, display_name, membership_user_id, created_at
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      seed.organizationId,
      seed.pilotId,
      `Generated Pilot ${seed.marker.toUpperCase()}`,
      seed.userId,
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.aircraft (
       organization_id, id, display_name, manufacturer, model, created_at
     ) VALUES ($1, $2, $3, 'Generated', 'Synthetic', $4)`,
    [
      seed.organizationId,
      seed.aircraftId,
      `Generated Aircraft ${seed.marker.toUpperCase()}`,
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.aircraft_identifiers (
       organization_id, id, aircraft_id, identifier_type, identifier_value,
       reliability, provenance, created_at
     ) VALUES (
       $1, $2, $3, 'manufacturer_serial', $4, 'stable', $5, $6
     )`,
    [
      seed.organizationId,
      seed.aircraftIdentifierId,
      seed.aircraftId,
      `generated-aircraft-${seed.marker}`,
      { origin: 'generated' },
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.raw_sources (
       organization_id, id, object_revision_id, content_sha256,
       byte_size, media_type, created_at
     ) VALUES ($1, $2, $3, $4, 128, 'application/octet-stream', $5)`,
    [
      seed.organizationId,
      seed.rawSourceId,
      seed.rawObjectRevisionId,
      seed.marker.repeat(64),
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.import_batches (
       organization_id, id, uploaded_by_user_id, state, created_at, completed_at
     ) VALUES ($1, $2, $3, 'completed', $4, $4)`,
    [seed.organizationId, seed.batchId, seed.userId, now],
  );
  await transaction.query(
    `INSERT INTO droneworks.import_items (
       organization_id, id, import_batch_id, raw_source_id, client_file_id,
       original_filename, state, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $7)`,
    [
      seed.organizationId,
      seed.itemId,
      seed.batchId,
      seed.rawSourceId,
      `generated-${seed.marker}`,
      `generated-${seed.marker}.txt`,
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.import_attempts (
       organization_id, id, import_item_id, attempt_number, state,
       parser_revision, started_at, finished_at
     ) VALUES ($1, $2, $3, 1, 'succeeded', 'generated-v1', $4, $4)`,
    [seed.organizationId, seed.attemptId, seed.itemId, now],
  );
  await transaction.query(
    `INSERT INTO droneworks.canonical_flights (
       organization_id, id, import_item_id, pilot_profile_id, aircraft_id,
       source_kind, state, takeoff_at, takeoff_timezone, duration_ms,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'imported', 'active', $6,
       'Asia/Dubai', 60000, $6, $6
     )`,
    [
      seed.organizationId,
      seed.flightId,
      seed.itemId,
      seed.pilotId,
      seed.aircraftId,
      now,
    ],
  );
  await transaction.query(
    `UPDATE droneworks.import_items
        SET result_flight_id = $3
      WHERE organization_id = $1 AND id = $2`,
    [seed.organizationId, seed.itemId, seed.flightId],
  );
  await transaction.query(
    `INSERT INTO droneworks.flight_revisions (
       organization_id, id, canonical_flight_id, import_attempt_id,
       revision_number, canonical_schema_version, facts, capabilities,
       exact_normalized_fingerprint, created_at
     ) VALUES ($1, $2, $3, $4, 1, 1, $5, $6, $7, $8)`,
    [
      seed.organizationId,
      seed.revisionId,
      seed.flightId,
      seed.attemptId,
      { origin: 'generated', duration_ms: 60_000 },
      ['telemetry.position'],
      (seed.marker === 'a' ? 'c' : 'd').repeat(64),
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.telemetry_objects (
       organization_id, id, flight_revision_id, object_revision_id,
       codec, codec_version, content_sha256, sample_count,
       first_elapsed_ms, last_elapsed_ms, capabilities, created_at
     ) VALUES ($1, $2, $3, $4, 'generated-columnar', 1, $5, 2, 0, 1000, $6, $7)`,
    [
      seed.organizationId,
      seed.telemetryId,
      seed.revisionId,
      seed.telemetryObjectRevisionId,
      (seed.marker === 'a' ? 'e' : 'f').repeat(64),
      ['telemetry.position'],
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.api_idempotency_requests (
       organization_id, user_id, operation, idempotency_key,
       request_sha256, response_status, response_body, created_at, completed_at
     ) VALUES ($1, $2, 'generated.seed', $3, $4, 201, $5, $6, $6)`,
    [
      seed.organizationId,
      seed.userId,
      `generated-${seed.marker}`,
      (seed.marker === 'a' ? '1' : '2').repeat(64),
      { id: seed.flightId },
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.audit_events (
       organization_id, id, actor_kind, actor_user_id, action,
       resource_type, resource_id, changed_fields, occurred_at
     ) VALUES ($1, $2, 'user', $3, 'generated.seed', 'flight', $4, $5, $6)`,
    [
      seed.organizationId,
      seed.auditId,
      seed.userId,
      seed.flightId,
      ['created'],
      now,
    ],
  );
  await transaction.query(
    `INSERT INTO droneworks.outbox_events (
       organization_id, id, event_type, payload_version, resource_type,
       resource_id, available_at, created_at
     ) VALUES ($1, $2, 'canonical-flight.created', 1, 'flight', $3, $4, $4)`,
    [seed.organizationId, seed.outboxId, seed.flightId, now],
  );
  await transaction.query(
    `INSERT INTO droneworks.keychain_authorizations (
       organization_id, raw_source_id, keychain_use_authorized,
       external_service_processing_authorized, notice_version, terms_version,
       approved_by_user_id, approved_at
     ) VALUES ($1, $2, true, true, 'generated-notice-v1',
               'generated-terms-v1', $3, $4)`,
    [seed.organizationId, seed.rawSourceId, seed.userId, now],
  );
  await transaction.query(
    `INSERT INTO droneworks.keychain_cache_entries (
       organization_id, raw_source_id, parser_id, log_version, provider_id,
       notice_version, terms_version, key_reference, key_version, nonce,
       authentication_tag, ciphertext, created_at, last_used_at
     ) VALUES ($1, $2, 'generated-seed-parser', 14, 'generated-provider',
               'generated-notice-v1', 'generated-terms-v1',
               'generated-key', 'v1', $3, $4, $5, $6, $6)`,
    [
      seed.organizationId,
      seed.rawSourceId,
      Buffer.alloc(12, seed.marker === 'a' ? 1 : 2),
      Buffer.alloc(16, seed.marker === 'a' ? 3 : 4),
      Buffer.from(`generated-ciphertext-${seed.marker}`),
      now,
    ],
  );
}
