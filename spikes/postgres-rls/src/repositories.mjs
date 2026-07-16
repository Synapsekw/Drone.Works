function requireId(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError(`${field} must be a non-empty identifier`);
  }
  return value;
}

function requireDate(value, field) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError(`${field} must be a valid Date`);
  }
  return value;
}

async function recordAuditEvent(client, input) {
  const resourceType = requireId(input.resourceType ?? "flight", "resourceType");
  const resourceId = requireId(input.resourceId ?? input.flightId, "resourceId");
  await client.query(
    `INSERT INTO droneworks.audit_events (
       organization_id,
       actor_user_id,
       action,
       resource_type,
       resource_id,
       changed_fields,
       metadata,
       occurred_at
     ) VALUES (
       droneworks.current_organization_id(),
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7
     )`,
    [
      requireId(input.userId, "userId"),
      input.action,
      resourceType,
      resourceId,
      input.changedFields,
      input.metadata,
      requireDate(input.now, "now").toISOString(),
    ],
  );
}

const ORGANIZATION_EXPORT_COLLECTIONS = Object.freeze([
  Object.freeze({
    name: "aircraft",
    sql: `SELECT organization_id, id, display_name
            FROM droneworks.aircraft
           ORDER BY id`,
  }),
  Object.freeze({
    name: "audit_events",
    sql: `SELECT organization_id,
                 id,
                 actor_user_id,
                 action,
                 resource_type,
                 resource_id,
                 changed_fields,
                 metadata,
                 occurred_at
            FROM droneworks.audit_events
           ORDER BY occurred_at, id`,
  }),
  Object.freeze({
    name: "batteries",
    sql: `SELECT organization_id,
                 id,
                 display_name,
                 serial_number,
                 lifecycle
            FROM droneworks.batteries
           ORDER BY id`,
  }),
  Object.freeze({
    name: "canonical_flights",
    sql: `SELECT organization_id,
                 id,
                 pilot_profile_id,
                 aircraft_id,
                 imported_pilot_profile_id,
                 imported_aircraft_id,
                 source_kind,
                 state,
                 takeoff_at,
                 takeoff_timezone,
                 duration_ms::text AS duration_ms,
                 location_text,
                 notes,
                 deleted_at,
                 deleted_from_state
            FROM droneworks.canonical_flights
           ORDER BY id`,
  }),
  Object.freeze({
    name: "flight_assignment_overrides",
    sql: `SELECT organization_id,
                 canonical_flight_id,
                 pilot_profile_id,
                 aircraft_id,
                 actor_user_id,
                 applied_at
            FROM droneworks.flight_assignment_overrides
           ORDER BY canonical_flight_id`,
  }),
  Object.freeze({
    name: "flight_batteries",
    sql: `SELECT organization_id, canonical_flight_id, battery_id, origin
            FROM droneworks.flight_batteries
           ORDER BY canonical_flight_id, battery_id`,
  }),
  Object.freeze({
    name: "flight_revisions",
    sql: `SELECT organization_id,
                 id,
                 canonical_flight_id,
                 processing_revision_id,
                 facts,
                 capabilities
            FROM droneworks.flight_revisions
           ORDER BY canonical_flight_id, processing_revision_id, id`,
  }),
  Object.freeze({
    name: "flight_tags",
    sql: `SELECT organization_id, canonical_flight_id, tag_id, origin
            FROM droneworks.flight_tags
           ORDER BY canonical_flight_id, tag_id`,
  }),
  Object.freeze({
    name: "import_batches",
    sql: `SELECT organization_id, id, uploaded_by_user_id, state, created_at
            FROM droneworks.import_batches
           ORDER BY id`,
  }),
  Object.freeze({
    name: "import_items",
    sql: `SELECT organization_id,
                 id,
                 import_batch_id,
                 client_file_id,
                 original_filename,
                 raw_source_id,
                 state,
                 created_at
            FROM droneworks.import_items
           ORDER BY import_batch_id, id`,
  }),
  Object.freeze({
    name: "maintenance_completions",
    sql: `SELECT organization_id,
                 id,
                 maintenance_schedule_id,
                 completed_by_user_id,
                 completed_at,
                 details,
                 recorded_at
            FROM droneworks.maintenance_completions
           ORDER BY maintenance_schedule_id, completed_at, id`,
  }),
  Object.freeze({
    name: "maintenance_schedules",
    sql: `SELECT organization_id,
                 id,
                 aircraft_id,
                 title,
                 schedule_type,
                 interval_value::text AS interval_value,
                 due_at,
                 baseline_at,
                 due_soon_threshold_percent,
                 due_soon_days,
                 created_by_user_id,
                 created_at
            FROM droneworks.maintenance_schedules
           ORDER BY id`,
  }),
  Object.freeze({
    name: "memberships",
    sql: `SELECT organization_id, user_id, role
            FROM droneworks.memberships
           ORDER BY user_id`,
  }),
  Object.freeze({
    name: "organizations",
    sql: `SELECT id,
                 name,
                 default_timezone,
                 unit_preference,
                 pilot_raw_download_enabled,
                 pilot_export_enabled,
                 state,
                 deletion_requested_at
            FROM droneworks.organizations
           ORDER BY id`,
  }),
  Object.freeze({
    name: "pilot_profiles",
    sql: `SELECT organization_id,
                 id,
                 display_name,
                 membership_user_id
            FROM droneworks.pilot_profiles
           ORDER BY id`,
  }),
  Object.freeze({
    name: "raw_source_flights",
    sql: `SELECT organization_id, raw_source_id, canonical_flight_id
            FROM droneworks.raw_source_flights
           ORDER BY raw_source_id, canonical_flight_id`,
  }),
  Object.freeze({
    name: "raw_sources",
    sql: `SELECT organization_id, id, state
            FROM droneworks.raw_sources
           ORDER BY id`,
  }),
  Object.freeze({
    name: "tags",
    sql: `SELECT organization_id, id, name
            FROM droneworks.tags
           ORDER BY id`,
  }),
  Object.freeze({
    name: "telemetry_samples",
    sql: `SELECT organization_id,
                 flight_revision_id,
                 elapsed_ms::text AS elapsed_ms,
                 height_agl_m
            FROM droneworks.telemetry_samples
           ORDER BY flight_revision_id, elapsed_ms`,
  }),
]);

const ORGANIZATION_EXPORT_SNAPSHOT_SQL = `
  SELECT jsonb_object_agg(collection.name, collection.rows ORDER BY collection.name)
    AS snapshot
    FROM (
      ${ORGANIZATION_EXPORT_COLLECTIONS.map((collection) => `
        SELECT '${collection.name}'::text AS name,
               coalesce(
                 jsonb_agg(
                   to_jsonb(export_row)
                   ORDER BY to_jsonb(export_row)::text
                 ),
                 '[]'::jsonb
               ) AS rows
          FROM (${collection.sql}) AS export_row
      `).join(" UNION ALL ")}
    ) AS collection`;

async function buildOrganizationExportManifest(client, generatedAt) {
  const result = await client.query(ORGANIZATION_EXPORT_SNAPSHOT_SQL);
  const snapshot = result.rows[0]?.snapshot;
  if (snapshot === null || typeof snapshot !== "object") {
    throw new Error("organization export snapshot could not be assembled");
  }
  const organization = snapshot.organizations[0];
  if (organization === undefined || snapshot.organizations.length !== 1) {
    throw new Error("organization export manifest has no organization root");
  }
  return {
    schema_version: 1,
    generated_at: requireDate(generatedAt, "generatedAt").toISOString(),
    canonical_time_basis: "UTC",
    organization: {
      id: organization.id,
      name: organization.name,
      default_timezone: organization.default_timezone,
      unit_preference: organization.unit_preference,
    },
    collections: ORGANIZATION_EXPORT_COLLECTIONS.map((collection) => ({
      name: collection.name,
      row_count: snapshot[collection.name].length,
    })),
    raw_sources: snapshot.raw_sources.map((source) => ({
      id: source.id,
      state: source.state,
    })),
    snapshot,
  };
}

function maintenanceScheduleFromRow(row) {
  const intervalValue = row.interval_value === null
    ? null
    : Number(row.interval_value);
  const flightCount = Number(row.usage_flight_count);
  const durationMs = Number(row.usage_duration_ms);
  let consumedValue = null;
  if (row.schedule_type === "flight_hours") {
    consumedValue = durationMs / 3_600_000;
  } else if (row.schedule_type === "flight_count") {
    consumedValue = flightCount;
  }
  return {
    id: row.id,
    organization_id: row.organization_id,
    aircraft_id: row.aircraft_id,
    aircraft_name: row.aircraft_name,
    title: row.title,
    schedule_type: row.schedule_type,
    interval_value: intervalValue,
    due_at: row.due_at,
    baseline_at: row.baseline_at,
    due_soon_threshold_percent: row.due_soon_threshold_percent,
    due_soon_days: row.due_soon_days,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    condition: row.condition,
    usage: {
      baseline_at: row.usage_baseline_at,
      flight_count: flightCount,
      duration_ms: durationMs,
      consumed_value: consumedValue,
    },
    last_completion: row.completion_id === null ? null : {
      id: row.completion_id,
      completed_by_user_id: row.completed_by_user_id,
      completed_at: row.completed_at,
      details: row.completion_details,
      recorded_at: row.completion_recorded_at,
    },
  };
}

async function findMaintenanceSchedules(client, { userId, scheduleId, now }) {
  const result = await client.query(
    `SELECT schedule.id,
            schedule.organization_id,
            schedule.aircraft_id,
            aircraft.display_name AS aircraft_name,
            schedule.title,
            schedule.schedule_type,
            schedule.interval_value,
            schedule.due_at,
            schedule.baseline_at,
            schedule.due_soon_threshold_percent,
            schedule.due_soon_days,
            schedule.created_by_user_id,
            schedule.created_at,
            coalesce(completion.completed_at, schedule.baseline_at)
              AS usage_baseline_at,
            usage.flight_count AS usage_flight_count,
            usage.duration_ms AS usage_duration_ms,
            completion.id AS completion_id,
            completion.completed_by_user_id,
            completion.completed_at,
            completion.details AS completion_details,
            completion.recorded_at AS completion_recorded_at,
            CASE
              WHEN schedule.schedule_type = 'one_shot_date'
                   AND completion.id IS NOT NULL THEN 'current'
              WHEN schedule.schedule_type = 'one_shot_date'
                   AND $3::timestamptz >= schedule.due_at THEN 'overdue'
              WHEN schedule.schedule_type = 'one_shot_date'
                   AND $3::timestamptz >= schedule.due_at
                     - make_interval(days => schedule.due_soon_days)
                THEN 'due_soon'
              WHEN schedule.schedule_type = 'flight_hours'
                   AND usage.duration_ms::numeric
                     >= schedule.interval_value::numeric * 3600000
                THEN 'overdue'
              WHEN schedule.schedule_type = 'flight_hours'
                   AND usage.duration_ms::numeric * 100
                     >= schedule.interval_value::numeric
                       * 3600000
                       * schedule.due_soon_threshold_percent
                THEN 'due_soon'
              WHEN schedule.schedule_type = 'flight_count'
                   AND usage.flight_count >= schedule.interval_value
                THEN 'overdue'
              WHEN schedule.schedule_type = 'flight_count'
                   AND usage.flight_count * 100
                     >= schedule.interval_value
                       * schedule.due_soon_threshold_percent
                THEN 'due_soon'
              ELSE 'current'
            END AS condition
       FROM droneworks.memberships AS membership
       JOIN droneworks.maintenance_schedules AS schedule
         ON schedule.organization_id = membership.organization_id
       JOIN droneworks.aircraft AS aircraft
         ON aircraft.organization_id = schedule.organization_id
        AND aircraft.id = schedule.aircraft_id
       LEFT JOIN LATERAL (
         SELECT maintenance.id,
                maintenance.completed_by_user_id,
                maintenance.completed_at,
                maintenance.details,
                maintenance.recorded_at
           FROM droneworks.maintenance_completions AS maintenance
          WHERE maintenance.organization_id = schedule.organization_id
            AND maintenance.maintenance_schedule_id = schedule.id
          ORDER BY maintenance.completed_at DESC, maintenance.id DESC
          LIMIT 1
       ) AS completion ON true
       CROSS JOIN LATERAL (
         SELECT count(*)::integer AS flight_count,
                coalesce(sum(flight.duration_ms), 0)::bigint AS duration_ms
           FROM droneworks.canonical_flights AS flight
          WHERE flight.aircraft_id = schedule.aircraft_id
            AND flight.state = 'active'
            AND flight.takeoff_at
              > coalesce(completion.completed_at, schedule.baseline_at)
       ) AS usage
      WHERE membership.user_id = $1
        AND ($2::text IS NULL OR schedule.id = $2)
      ORDER BY schedule.id`,
    [
      requireId(userId, "userId"),
      scheduleId === null ? null : requireId(scheduleId, "scheduleId"),
      requireDate(now, "now").toISOString(),
    ],
  );
  return result.rows.map(maintenanceScheduleFromRow);
}

export function createRepositories(client) {
  return Object.freeze({
    async connectionId() {
      const result = await client.query("SELECT pg_backend_pid() AS pid");
      return Number(result.rows[0].pid);
    },

    async findFlightById(flightId) {
      requireId(flightId, "flightId");
      const result = await client.query(
        `SELECT id, organization_id, aircraft_id, pilot_profile_id, duration_ms, notes
           FROM droneworks.canonical_flights
          WHERE id = $1`,
        [flightId],
      );
      return result.rows[0] ?? null;
    },

    async findFlightForMember({ userId, flightId }) {
      requireId(userId, "userId");
      requireId(flightId, "flightId");
      const result = await client.query(
        `SELECT f.id,
                f.organization_id,
                f.aircraft_id,
                f.pilot_profile_id,
                f.duration_ms,
                f.notes
           FROM droneworks.memberships AS m
           JOIN droneworks.canonical_flights AS f
             ON f.organization_id = m.organization_id
          WHERE m.user_id = $1
            AND f.id = $2
            AND f.state <> 'deleted'
          FOR KEY SHARE OF m, f`,
        [userId, flightId],
      );
      return result.rows[0] ?? null;
    },

    async listFlightsWithAircraft() {
      const result = await client.query(
        `SELECT f.id, f.organization_id, a.display_name AS aircraft_name
           FROM droneworks.canonical_flights AS f
           JOIN droneworks.aircraft AS a
             ON a.organization_id = f.organization_id
            AND a.id = f.aircraft_id
          WHERE f.state <> 'deleted'
          ORDER BY f.id`,
      );
      return result.rows;
    },

    async flightTotals() {
      const result = await client.query(
        `SELECT count(*)::integer AS flight_count,
                coalesce(sum(duration_ms), 0)::bigint AS duration_ms
           FROM droneworks.canonical_flights
          WHERE state = 'active'`,
      );
      return {
        flightCount: result.rows[0].flight_count,
        durationMs: Number(result.rows[0].duration_ms),
      };
    },

    async exportFlights() {
      const result = await client.query(
        `SELECT f.id, f.organization_id, f.duration_ms,
                r.id AS revision_id,
                count(t.elapsed_ms)::integer AS telemetry_sample_count
           FROM droneworks.canonical_flights AS f
           JOIN droneworks.flight_revisions AS r
             ON r.organization_id = f.organization_id
            AND r.canonical_flight_id = f.id
           LEFT JOIN droneworks.telemetry_samples AS t
             ON t.organization_id = r.organization_id
            AND t.flight_revision_id = r.id
          GROUP BY f.id, f.organization_id, f.duration_ms, r.id
          ORDER BY f.id`,
      );
      return result.rows;
    },

    async updateFlightNotes(flightId, notes) {
      requireId(flightId, "flightId");
      if (typeof notes !== "string") {
        throw new TypeError("notes must be a string");
      }
      const result = await client.query(
        `UPDATE droneworks.canonical_flights
            SET notes = $2
          WHERE id = $1
          RETURNING id, organization_id, notes`,
        [flightId, notes],
      );
      return result.rows[0] ?? null;
    },

    async insertFlight(input) {
      const result = await client.query(
        `INSERT INTO droneworks.canonical_flights (
           organization_id,
           id,
           pilot_profile_id,
           aircraft_id,
           imported_pilot_profile_id,
           imported_aircraft_id,
           source_kind,
           state,
           takeoff_at,
           takeoff_timezone,
           duration_ms,
           location_text
         ) VALUES ($1, $2, $3, $4, $3, $4, 'imported', 'active', $5, $6, $7, $8)
         RETURNING id, organization_id`,
        [
          requireId(input.organizationId, "organizationId"),
          requireId(input.flightId, "flightId"),
          requireId(input.pilotProfileId, "pilotProfileId"),
          requireId(input.aircraftId, "aircraftId"),
          requireDate(input.takeoffAt, "takeoffAt").toISOString(),
          requireId(input.takeoffTimezone, "takeoffTimezone"),
          input.durationMs,
          input.locationText,
        ],
      );
      return result.rows[0];
    },

    async createManualFlightForMember(input) {
      const userId = requireId(input.userId, "userId");
      const pilotProfileId = requireId(input.pilotProfileId, "pilotProfileId");
      const aircraftId = requireId(input.aircraftId, "aircraftId");
      const idempotencyKey = requireId(input.idempotencyKey, "idempotencyKey");
      const requestHash = requireId(input.requestHash, "requestHash");
      const now = requireDate(input.now, "now");
      if (typeof input.createFlightId !== "function") {
        throw new TypeError("createFlightId must be a function");
      }

      const membership = await client.query(
        `SELECT m.role
           FROM droneworks.memberships AS m
          WHERE m.user_id = $1
          FOR KEY SHARE OF m`,
        [userId],
      );
      const member = membership.rows[0];
      if (member === undefined || !["owner", "admin", "pilot"].includes(member.role)) {
        return null;
      }
      const targets = await client.query(
        `SELECT EXISTS (
                  SELECT 1
                    FROM droneworks.pilot_profiles
                   WHERE id = $1
                ) AS pilot_exists,
                EXISTS (
                  SELECT 1
                    FROM droneworks.aircraft
                   WHERE id = $2
                ) AS aircraft_exists`,
        [pilotProfileId, aircraftId],
      );
      if (!targets.rows[0].pilot_exists || !targets.rows[0].aircraft_exists) {
        return null;
      }

      const operation = "create_manual_flight";
      const claim = await client.query(
        `INSERT INTO droneworks.api_idempotency_requests (
           organization_id,
           user_id,
           operation,
           idempotency_key,
           request_hash,
           created_at
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           $3,
           $4,
           $5
         )
         ON CONFLICT DO NOTHING
         RETURNING request_hash`,
        [userId, operation, idempotencyKey, requestHash, now.toISOString()],
      );
      if (claim.rowCount === 0) {
        const previous = await client.query(
          `SELECT request_hash, response_status, response_body
             FROM droneworks.api_idempotency_requests
            WHERE user_id = $1
              AND operation = $2
              AND idempotency_key = $3
            FOR UPDATE`,
          [userId, operation, idempotencyKey],
        );
        const saved = previous.rows[0];
        if (saved.request_hash !== requestHash) {
          return { kind: "conflict" };
        }
        if (saved.response_status !== 201 || saved.response_body === null) {
          throw new Error("idempotent request is incomplete");
        }
        return { kind: "replayed", flight: saved.response_body };
      }

      const flightId = requireId(input.createFlightId(), "flightId");
      const created = await client.query(
        `INSERT INTO droneworks.canonical_flights (
           organization_id,
           id,
           pilot_profile_id,
           aircraft_id,
           source_kind,
           state,
           takeoff_at,
           takeoff_timezone,
           duration_ms,
           location_text,
           notes
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           $3,
           'manual',
           'active',
           $4,
           $5,
           $6,
           $7,
           $8
         )
         RETURNING id,
                   organization_id,
                   pilot_profile_id,
                   aircraft_id,
                   source_kind,
                   state,
                   takeoff_at,
                   takeoff_timezone,
                   duration_ms,
                   location_text,
                   notes`,
        [
          flightId,
          pilotProfileId,
          aircraftId,
          requireDate(input.takeoffAt, "takeoffAt").toISOString(),
          requireId(input.takeoffTimezone, "takeoffTimezone"),
          input.durationMs,
          input.locationText,
          input.notes,
        ],
      );
      const flight = created.rows[0];
      await recordAuditEvent(client, {
        userId,
        action: "flight.created_manual",
        flightId,
        changedFields: [
          "pilot_profile_id",
          "aircraft_id",
          "takeoff_at",
          "takeoff_timezone",
          "duration_ms",
          "location_text",
          "notes",
        ],
        metadata: { source_kind: "manual" },
        now,
      });
      await client.query(
        `UPDATE droneworks.api_idempotency_requests
            SET response_status = 201,
                response_body = $4,
                completed_at = $5
          WHERE user_id = $1
            AND operation = $2
            AND idempotency_key = $3`,
        [userId, operation, idempotencyKey, JSON.stringify(flight), now.toISOString()],
      );
      return { kind: "created", flight };
    },

    async updateFlightNotesForMember({ userId, flightId, notes, now }) {
      requireId(userId, "userId");
      requireId(flightId, "flightId");
      if (typeof notes !== "string") {
        throw new TypeError("notes must be a string");
      }
      const updated = await client.query(
        `UPDATE droneworks.canonical_flights AS f
            SET notes = $3
           FROM droneworks.memberships AS m
          WHERE m.organization_id = f.organization_id
            AND m.user_id = $1
            AND f.id = $2
            AND f.state <> 'deleted'
            AND (
              m.role IN ('owner', 'admin')
              OR (
                m.role = 'pilot'
                AND EXISTS (
                  SELECT 1
                    FROM droneworks.pilot_profiles AS p
                   WHERE p.organization_id = f.organization_id
                     AND p.id = f.pilot_profile_id
                     AND p.membership_user_id = m.user_id
                )
              )
            )
         RETURNING f.id, f.organization_id, f.notes`,
        [userId, flightId, notes],
      );
      const flight = updated.rows[0] ?? null;
      if (flight !== null) {
        await recordAuditEvent(client, {
          userId,
          action: "flight.notes_updated",
          flightId,
          changedFields: ["notes"],
          metadata: {},
          now,
        });
      }
      return flight;
    },

    async reassignFlightForMember({
      userId,
      flightId,
      pilotProfileId,
      aircraftId,
      now,
    }) {
      requireId(userId, "userId");
      requireId(flightId, "flightId");
      requireId(pilotProfileId, "pilotProfileId");
      requireId(aircraftId, "aircraftId");

      const current = await client.query(
        `SELECT f.id,
                f.organization_id,
                f.pilot_profile_id,
                f.aircraft_id,
                f.imported_pilot_profile_id,
                f.imported_aircraft_id
           FROM droneworks.memberships AS m
           JOIN droneworks.canonical_flights AS f
             ON f.organization_id = m.organization_id
          WHERE m.user_id = $1
            AND m.role IN ('owner', 'admin')
            AND f.id = $2
            AND f.state <> 'deleted'
          FOR UPDATE OF f`,
        [userId, flightId],
      );
      const previous = current.rows[0];
      if (previous === undefined) {
        return null;
      }
      const targets = await client.query(
        `SELECT EXISTS (
                  SELECT 1 FROM droneworks.pilot_profiles WHERE id = $1
                ) AS pilot_exists,
                EXISTS (
                  SELECT 1 FROM droneworks.aircraft WHERE id = $2
                ) AS aircraft_exists`,
        [pilotProfileId, aircraftId],
      );
      if (!targets.rows[0].pilot_exists || !targets.rows[0].aircraft_exists) {
        return null;
      }
      if (previous.pilot_profile_id === pilotProfileId
          && previous.aircraft_id === aircraftId) {
        return {
          id: previous.id,
          organization_id: previous.organization_id,
          pilot_profile_id: pilotProfileId,
          aircraft_id: aircraftId,
        };
      }

      const returnsToImportedAssignment =
        previous.imported_pilot_profile_id === pilotProfileId
        && previous.imported_aircraft_id === aircraftId;
      if (returnsToImportedAssignment) {
        await client.query(
          `DELETE FROM droneworks.flight_assignment_overrides
            WHERE canonical_flight_id = $1`,
          [flightId],
        );
      } else {
        await client.query(
          `INSERT INTO droneworks.flight_assignment_overrides (
             organization_id,
             canonical_flight_id,
             pilot_profile_id,
             aircraft_id,
             actor_user_id,
             applied_at
           ) VALUES (
             droneworks.current_organization_id(),
             $1,
             $2,
             $3,
             $4,
             $5
           )
           ON CONFLICT (organization_id, canonical_flight_id)
           DO UPDATE SET pilot_profile_id = EXCLUDED.pilot_profile_id,
                         aircraft_id = EXCLUDED.aircraft_id,
                         actor_user_id = EXCLUDED.actor_user_id,
                         applied_at = EXCLUDED.applied_at`,
          [
            flightId,
            pilotProfileId,
            aircraftId,
            userId,
            requireDate(now, "now").toISOString(),
          ],
        );
      }

      const updated = await client.query(
        `UPDATE droneworks.canonical_flights
            SET pilot_profile_id = $2,
                aircraft_id = $3
          WHERE id = $1
         RETURNING id, organization_id, pilot_profile_id, aircraft_id`,
        [flightId, pilotProfileId, aircraftId],
      );
      const flight = updated.rows[0];
      const changedFields = [];
      if (previous.pilot_profile_id !== pilotProfileId) {
        changedFields.push("pilot_profile_id");
      }
      if (previous.aircraft_id !== aircraftId) {
        changedFields.push("aircraft_id");
      }
      await recordAuditEvent(client, {
        userId,
        action: "flight.assignment_updated",
        flightId,
        changedFields,
        metadata: {
          from: {
            pilot_profile_id: previous.pilot_profile_id,
            aircraft_id: previous.aircraft_id,
          },
          to: { pilot_profile_id: pilotProfileId, aircraft_id: aircraftId },
        },
        now,
      });
      return flight;
    },

    async findFlightAssignmentState(flightId) {
      requireId(flightId, "flightId");
      const result = await client.query(
        `SELECT f.pilot_profile_id,
                f.aircraft_id,
                f.imported_pilot_profile_id,
                f.imported_aircraft_id,
                o.pilot_profile_id AS override_pilot_profile_id,
                o.aircraft_id AS override_aircraft_id
           FROM droneworks.canonical_flights AS f
           LEFT JOIN droneworks.flight_assignment_overrides AS o
             ON o.organization_id = f.organization_id
            AND o.canonical_flight_id = f.id
          WHERE f.id = $1`,
        [flightId],
      );
      return result.rows[0] ?? null;
    },

    async deleteFlightForMember({ userId, flightId, now }) {
      requireId(userId, "userId");
      requireId(flightId, "flightId");
      const deleted = await client.query(
        `UPDATE droneworks.canonical_flights AS f
            SET deleted_from_state = f.state,
                state = 'deleted',
                deleted_at = $3
           FROM droneworks.memberships AS m
          WHERE m.organization_id = f.organization_id
            AND m.user_id = $1
            AND m.role IN ('owner', 'admin')
            AND f.id = $2
            AND f.state <> 'deleted'
         RETURNING f.id, f.organization_id, f.state, f.deleted_at`,
        [userId, flightId, requireDate(now, "now").toISOString()],
      );
      const flight = deleted.rows[0] ?? null;
      if (flight !== null) {
        await recordAuditEvent(client, {
          userId,
          action: "flight.deleted",
          flightId,
          changedFields: ["state", "deleted_at"],
          metadata: {},
          now,
        });
      }
      return flight;
    },

    async restoreFlightForMember({ userId, flightId, now }) {
      requireId(userId, "userId");
      requireId(flightId, "flightId");
      const restored = await client.query(
        `UPDATE droneworks.canonical_flights AS f
            SET state = f.deleted_from_state,
                deleted_at = NULL,
                deleted_from_state = NULL
           FROM droneworks.memberships AS m
          WHERE m.organization_id = f.organization_id
            AND m.user_id = $1
            AND m.role IN ('owner', 'admin')
            AND f.id = $2
            AND f.state = 'deleted'
            AND f.deleted_at > $3::timestamptz - interval '30 days'
         RETURNING f.id, f.organization_id, f.state, f.deleted_at`,
        [userId, flightId, requireDate(now, "now").toISOString()],
      );
      const flight = restored.rows[0] ?? null;
      if (flight !== null) {
        await recordAuditEvent(client, {
          userId,
          action: "flight.restored",
          flightId,
          changedFields: ["state", "deleted_at"],
          metadata: {},
          now,
        });
      }
      return flight;
    },

    async listAuditEvents() {
      const result = await client.query(
        `SELECT actor_user_id,
                action,
                resource_type,
                resource_id,
                changed_fields,
                metadata,
                occurred_at
           FROM droneworks.audit_events
          ORDER BY occurred_at, action, resource_id`,
      );
      return result.rows;
    },

    async listMembersForManager(userId) {
      requireId(userId, "userId");
      const result = await client.query(
        `SELECT target.user_id, target.role
           FROM droneworks.memberships AS actor
           JOIN droneworks.memberships AS target
             ON target.organization_id = actor.organization_id
          WHERE actor.user_id = $1
            AND actor.role IN ('owner', 'admin')
          ORDER BY target.user_id`,
        [userId],
      );
      return result.rows.length === 0 ? null : result.rows;
    },

    async putMemberForManager({ userId, targetUserId, role, now }) {
      requireId(userId, "userId");
      requireId(targetUserId, "targetUserId");
      if (!["admin", "pilot", "viewer"].includes(role)) {
        throw new TypeError("role must be admin, pilot, or viewer");
      }
      const actor = await client.query(
        `SELECT role
           FROM droneworks.memberships
          WHERE user_id = $1
            AND role IN ('owner', 'admin')
          FOR UPDATE`,
        [userId],
      );
      if (actor.rowCount === 0) {
        return null;
      }
      const target = await client.query(
        `SELECT role
           FROM droneworks.memberships
          WHERE user_id = $1
          FOR UPDATE`,
        [targetUserId],
      );
      const previousRole = target.rows[0]?.role;
      if (previousRole === "owner") {
        return null;
      }
      const saved = await client.query(
        `INSERT INTO droneworks.memberships (
           organization_id,
           user_id,
           role
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2
         )
         ON CONFLICT (organization_id, user_id)
         DO UPDATE SET role = EXCLUDED.role
         WHERE memberships.role <> 'owner'
         RETURNING organization_id, user_id, role`,
        [targetUserId, role],
      );
      const member = saved.rows[0] ?? null;
      if (member === null) {
        return null;
      }
      if (previousRole !== role) {
        await recordAuditEvent(client, {
          userId,
          action: previousRole === undefined
            ? "membership.added"
            : "membership.role_updated",
          resourceType: "membership",
          resourceId: targetUserId,
          changedFields: ["role"],
          metadata: {},
          now,
        });
      }
      return {
        kind: previousRole === undefined ? "created" : "saved",
        member,
      };
    },

    async deleteMemberForManager({ userId, targetUserId, now }) {
      requireId(userId, "userId");
      requireId(targetUserId, "targetUserId");
      const deleted = await client.query(
        `DELETE FROM droneworks.memberships AS target
          USING droneworks.memberships AS actor
          WHERE actor.organization_id = target.organization_id
            AND actor.user_id = $1
            AND actor.role IN ('owner', 'admin')
            AND target.user_id = $2
            AND target.role <> 'owner'
        RETURNING target.organization_id, target.user_id, target.role`,
        [userId, targetUserId],
      );
      const member = deleted.rows[0] ?? null;
      if (member !== null) {
        await recordAuditEvent(client, {
          userId,
          action: "membership.removed",
          resourceType: "membership",
          resourceId: targetUserId,
          changedFields: ["role"],
          metadata: {},
          now,
        });
      }
      return member;
    },

    async updateOrganizationSettingsForManager({ userId, settings, now }) {
      requireId(userId, "userId");
      if (settings === null || typeof settings !== "object") {
        throw new TypeError("settings must be an object");
      }
      const current = await client.query(
        `SELECT organization.id,
                organization.name,
                organization.default_timezone,
                organization.unit_preference,
                organization.pilot_raw_download_enabled,
                organization.pilot_export_enabled
           FROM droneworks.memberships AS actor
           JOIN droneworks.organizations AS organization
             ON organization.id = actor.organization_id
          WHERE actor.user_id = $1
            AND actor.role IN ('owner', 'admin')
          FOR UPDATE OF actor, organization`,
        [userId],
      );
      const previous = current.rows[0];
      if (previous === undefined) {
        return null;
      }
      const requested = {
        name: settings.name ?? previous.name,
        default_timezone: settings.defaultTimezone ?? previous.default_timezone,
        unit_preference: settings.unitPreference ?? previous.unit_preference,
        pilot_raw_download_enabled:
          settings.pilotRawDownloadEnabled ?? previous.pilot_raw_download_enabled,
        pilot_export_enabled:
          settings.pilotExportEnabled ?? previous.pilot_export_enabled,
      };
      const changedFields = Object.keys(requested).filter(
        (field) => requested[field] !== previous[field],
      );
      if (changedFields.length === 0) {
        return previous;
      }
      const updated = await client.query(
        `UPDATE droneworks.organizations
            SET name = $1,
                default_timezone = $2,
                unit_preference = $3,
                pilot_raw_download_enabled = $4,
                pilot_export_enabled = $5
          WHERE id = $6
        RETURNING id,
                  name,
                  default_timezone,
                  unit_preference,
                  pilot_raw_download_enabled,
                  pilot_export_enabled`,
        [
          requested.name,
          requested.default_timezone,
          requested.unit_preference,
          requested.pilot_raw_download_enabled,
          requested.pilot_export_enabled,
          previous.id,
        ],
      );
      await recordAuditEvent(client, {
        userId,
        action: "organization.settings_updated",
        resourceType: "organization",
        resourceId: previous.id,
        changedFields,
        metadata: {},
        now,
      });
      return updated.rows[0];
    },

    async transferOrganizationOwnership({ userId, newOwnerUserId, now }) {
      requireId(userId, "userId");
      requireId(newOwnerUserId, "newOwnerUserId");
      const memberships = await client.query(
        `SELECT user_id, role, organization_id
           FROM droneworks.memberships
          WHERE user_id IN ($1, $2)
          ORDER BY user_id
          FOR UPDATE`,
        [userId, newOwnerUserId],
      );
      const actor = memberships.rows.find((member) => member.user_id === userId);
      const target = memberships.rows.find(
        (member) => member.user_id === newOwnerUserId,
      );
      if (actor?.role !== "owner" || target === undefined) {
        return null;
      }
      if (userId === newOwnerUserId) {
        return {
          organization_id: actor.organization_id,
          previous_owner_user_id: userId,
          new_owner_user_id: userId,
        };
      }
      await client.query(
        `UPDATE droneworks.memberships
            SET role = 'admin'
          WHERE user_id = $1
            AND role = 'owner'`,
        [userId],
      );
      const promoted = await client.query(
        `UPDATE droneworks.memberships
            SET role = 'owner'
          WHERE user_id = $1
            AND role <> 'owner'
        RETURNING organization_id`,
        [newOwnerUserId],
      );
      if (promoted.rowCount !== 1) {
        throw new Error("ownership transfer target could not be promoted");
      }
      await recordAuditEvent(client, {
        userId,
        action: "organization.ownership_transferred",
        resourceType: "organization",
        resourceId: actor.organization_id,
        changedFields: ["owner_user_id"],
        metadata: {
          previous_owner_user_id: userId,
          new_owner_user_id: newOwnerUserId,
        },
        now,
      });
      return {
        organization_id: actor.organization_id,
        previous_owner_user_id: userId,
        new_owner_user_id: newOwnerUserId,
      };
    },

    async requestOrganizationDeletionForOwner({ userId, now }) {
      requireId(userId, "userId");
      const requestedAt = requireDate(now, "now").toISOString();
      const current = await client.query(
        `SELECT organization.id,
                organization.state,
                organization.deletion_requested_at
           FROM droneworks.memberships AS actor
           JOIN droneworks.organizations AS organization
             ON organization.id = actor.organization_id
          WHERE actor.user_id = $1
            AND actor.role = 'owner'
          FOR UPDATE OF actor, organization`,
        [userId],
      );
      const organization = current.rows[0];
      if (organization === undefined) {
        return null;
      }
      if (organization.state === "pending_deletion") {
        return organization;
      }
      const updated = await client.query(
        `UPDATE droneworks.organizations
            SET state = 'pending_deletion',
                deletion_requested_at = $2
          WHERE id = $1
        RETURNING id, state, deletion_requested_at`,
        [organization.id, requestedAt],
      );
      await recordAuditEvent(client, {
        userId,
        action: "organization.deletion_requested",
        resourceType: "organization",
        resourceId: organization.id,
        changedFields: ["state", "deletion_requested_at"],
        metadata: {},
        now,
      });
      return updated.rows[0];
    },

    async cancelOrganizationDeletionForOwner({ userId, now }) {
      requireId(userId, "userId");
      const cancelled = await client.query(
        `UPDATE droneworks.organizations AS organization
            SET state = 'active',
                deletion_requested_at = NULL
           FROM droneworks.memberships AS actor
          WHERE actor.organization_id = organization.id
            AND actor.user_id = $1
            AND actor.role = 'owner'
            AND organization.state = 'pending_deletion'
        RETURNING organization.id,
                  organization.state,
                  organization.deletion_requested_at`,
        [userId],
      );
      const organization = cancelled.rows[0] ?? null;
      if (organization !== null) {
        await recordAuditEvent(client, {
          userId,
          action: "organization.deletion_cancelled",
          resourceType: "organization",
          resourceId: organization.id,
          changedFields: ["state", "deletion_requested_at"],
          metadata: {},
          now,
        });
      }
      return organization;
    },

    async listTagsForMember(userId) {
      requireId(userId, "userId");
      const membership = await client.query(
        `SELECT role
           FROM droneworks.memberships
          WHERE user_id = $1
          FOR KEY SHARE`,
        [userId],
      );
      if (membership.rowCount === 0) {
        return null;
      }
      const result = await client.query(
        `SELECT id, name
           FROM droneworks.tags
          ORDER BY name, id`,
      );
      return result.rows;
    },

    async putFlightTagForMember({ userId, flightId, tagId, now }) {
      requireId(userId, "userId");
      requireId(flightId, "flightId");
      requireId(tagId, "tagId");
      const authorized = await client.query(
        `SELECT f.organization_id
           FROM droneworks.memberships AS membership
           JOIN droneworks.canonical_flights AS f
             ON f.organization_id = membership.organization_id
           JOIN droneworks.tags AS tag
             ON tag.organization_id = f.organization_id
            AND tag.id = $3
          WHERE membership.user_id = $1
            AND f.id = $2
            AND f.state <> 'deleted'
            AND (
              membership.role IN ('owner', 'admin')
              OR (
                membership.role = 'pilot'
                AND EXISTS (
                  SELECT 1
                    FROM droneworks.pilot_profiles AS pilot
                   WHERE pilot.organization_id = f.organization_id
                     AND pilot.id = f.pilot_profile_id
                     AND pilot.membership_user_id = membership.user_id
                )
              )
            )
          FOR KEY SHARE OF membership, f, tag`,
        [userId, flightId, tagId],
      );
      if (authorized.rowCount === 0) {
        return null;
      }
      const inserted = await client.query(
        `INSERT INTO droneworks.flight_tags (
           organization_id,
           canonical_flight_id,
           tag_id,
           origin
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           'user_override'
         )
         ON CONFLICT DO NOTHING
         RETURNING canonical_flight_id, tag_id, origin`,
        [flightId, tagId],
      );
      const link = inserted.rows[0] ?? (await client.query(
        `SELECT canonical_flight_id, tag_id, origin
           FROM droneworks.flight_tags
          WHERE canonical_flight_id = $1
            AND tag_id = $2`,
        [flightId, tagId],
      )).rows[0];
      if (inserted.rowCount === 1) {
        await recordAuditEvent(client, {
          userId,
          action: "flight.tag_added",
          flightId,
          changedFields: ["tags"],
          metadata: {},
          now,
        });
      }
      return link;
    },

    async deleteFlightTagForMember({ userId, flightId, tagId, now }) {
      requireId(userId, "userId");
      requireId(flightId, "flightId");
      requireId(tagId, "tagId");
      const deleted = await client.query(
        `DELETE FROM droneworks.flight_tags AS link
          USING droneworks.canonical_flights AS flight,
                droneworks.memberships AS membership
          WHERE flight.organization_id = link.organization_id
            AND flight.id = link.canonical_flight_id
            AND membership.organization_id = flight.organization_id
            AND membership.user_id = $1
            AND link.canonical_flight_id = $2
            AND link.tag_id = $3
            AND link.origin = 'user_override'
            AND flight.state <> 'deleted'
            AND (
              membership.role IN ('owner', 'admin')
              OR (
                membership.role = 'pilot'
                AND EXISTS (
                  SELECT 1
                    FROM droneworks.pilot_profiles AS pilot
                   WHERE pilot.organization_id = flight.organization_id
                     AND pilot.id = flight.pilot_profile_id
                     AND pilot.membership_user_id = membership.user_id
                )
              )
            )
        RETURNING link.canonical_flight_id, link.tag_id, link.origin`,
        [userId, flightId, tagId],
      );
      const link = deleted.rows[0] ?? null;
      if (link !== null) {
        await recordAuditEvent(client, {
          userId,
          action: "flight.tag_removed",
          flightId,
          changedFields: ["tags"],
          metadata: {},
          now,
        });
      }
      return link;
    },

    async listBatteriesForMember(userId) {
      requireId(userId, "userId");
      const membership = await client.query(
        `SELECT role
           FROM droneworks.memberships
          WHERE user_id = $1
          FOR KEY SHARE`,
        [userId],
      );
      if (membership.rowCount === 0) {
        return null;
      }
      const result = await client.query(
        `SELECT id, display_name, serial_number, lifecycle
           FROM droneworks.batteries
          ORDER BY display_name, id`,
      );
      return result.rows;
    },

    async updateBatteryForManager({ userId, batteryId, battery, now }) {
      requireId(userId, "userId");
      requireId(batteryId, "batteryId");
      if (battery === null || typeof battery !== "object") {
        throw new TypeError("battery must be an object");
      }
      const current = await client.query(
        `SELECT resource.id,
                resource.display_name,
                resource.serial_number,
                resource.lifecycle
           FROM droneworks.memberships AS membership
           JOIN droneworks.batteries AS resource
             ON resource.organization_id = membership.organization_id
          WHERE membership.user_id = $1
            AND membership.role IN ('owner', 'admin')
            AND resource.id = $2
          FOR UPDATE OF membership, resource`,
        [userId, batteryId],
      );
      const previous = current.rows[0];
      if (previous === undefined) {
        return null;
      }
      const requested = {
        display_name: battery.displayName ?? previous.display_name,
        serial_number: Object.hasOwn(battery, "serialNumber")
          ? battery.serialNumber
          : previous.serial_number,
        lifecycle: battery.lifecycle ?? previous.lifecycle,
      };
      const changedFields = Object.keys(requested).filter(
        (field) => requested[field] !== previous[field],
      );
      if (changedFields.length === 0) {
        return previous;
      }
      const updated = await client.query(
        `UPDATE droneworks.batteries
            SET display_name = $2,
                serial_number = $3,
                lifecycle = $4
          WHERE id = $1
        RETURNING id, display_name, serial_number, lifecycle`,
        [
          batteryId,
          requested.display_name,
          requested.serial_number,
          requested.lifecycle,
        ],
      );
      await recordAuditEvent(client, {
        userId,
        action: "battery.updated",
        resourceType: "battery",
        resourceId: batteryId,
        changedFields,
        metadata: {},
        now,
      });
      return updated.rows[0];
    },

    async putFlightBatteryForManager({ userId, flightId, batteryId, now }) {
      requireId(userId, "userId");
      requireId(flightId, "flightId");
      requireId(batteryId, "batteryId");
      const authorized = await client.query(
        `SELECT flight.organization_id
           FROM droneworks.memberships AS membership
           JOIN droneworks.canonical_flights AS flight
             ON flight.organization_id = membership.organization_id
           JOIN droneworks.batteries AS battery
             ON battery.organization_id = flight.organization_id
            AND battery.id = $3
          WHERE membership.user_id = $1
            AND membership.role IN ('owner', 'admin')
            AND flight.id = $2
            AND flight.state <> 'deleted'
          FOR KEY SHARE OF membership, flight, battery`,
        [userId, flightId, batteryId],
      );
      if (authorized.rowCount === 0) {
        return null;
      }
      const inserted = await client.query(
        `INSERT INTO droneworks.flight_batteries (
           organization_id,
           canonical_flight_id,
           battery_id,
           origin
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           'user_override'
         )
         ON CONFLICT DO NOTHING
         RETURNING canonical_flight_id, battery_id, origin`,
        [flightId, batteryId],
      );
      const link = inserted.rows[0] ?? (await client.query(
        `SELECT canonical_flight_id, battery_id, origin
           FROM droneworks.flight_batteries
          WHERE canonical_flight_id = $1
            AND battery_id = $2`,
        [flightId, batteryId],
      )).rows[0];
      if (inserted.rowCount === 1) {
        await recordAuditEvent(client, {
          userId,
          action: "flight.battery_added",
          flightId,
          changedFields: ["batteries"],
          metadata: {},
          now,
        });
      }
      return link;
    },

    async deleteFlightBatteryForManager({ userId, flightId, batteryId, now }) {
      requireId(userId, "userId");
      requireId(flightId, "flightId");
      requireId(batteryId, "batteryId");
      const deleted = await client.query(
        `DELETE FROM droneworks.flight_batteries AS link
          USING droneworks.canonical_flights AS flight,
                droneworks.memberships AS membership
          WHERE flight.organization_id = link.organization_id
            AND flight.id = link.canonical_flight_id
            AND membership.organization_id = flight.organization_id
            AND membership.user_id = $1
            AND membership.role IN ('owner', 'admin')
            AND link.canonical_flight_id = $2
            AND link.battery_id = $3
            AND link.origin = 'user_override'
            AND flight.state <> 'deleted'
        RETURNING link.canonical_flight_id, link.battery_id, link.origin`,
        [userId, flightId, batteryId],
      );
      const link = deleted.rows[0] ?? null;
      if (link !== null) {
        await recordAuditEvent(client, {
          userId,
          action: "flight.battery_removed",
          flightId,
          changedFields: ["batteries"],
          metadata: {},
          now,
        });
      }
      return link;
    },

    async createImportBatchForMember(input) {
      const userId = requireId(input.userId, "userId");
      const idempotencyKey = requireId(input.idempotencyKey, "idempotencyKey");
      const requestHash = requireId(input.requestHash, "requestHash");
      const now = requireDate(input.now, "now");
      if (!Array.isArray(input.files) || input.files.length === 0) {
        throw new TypeError("files must be a non-empty array");
      }
      if (typeof input.createId !== "function") {
        throw new TypeError("createId must be a function");
      }
      const membership = await client.query(
        `SELECT role
           FROM droneworks.memberships
          WHERE user_id = $1
            AND role IN ('owner', 'admin', 'pilot')
          FOR KEY SHARE`,
        [userId],
      );
      if (membership.rowCount === 0) {
        return null;
      }

      const operation = "create_import_batch";
      const claim = await client.query(
        `INSERT INTO droneworks.api_idempotency_requests (
           organization_id,
           user_id,
           operation,
           idempotency_key,
           request_hash,
           created_at
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           $3,
           $4,
           $5
         )
         ON CONFLICT DO NOTHING
         RETURNING request_hash`,
        [userId, operation, idempotencyKey, requestHash, now.toISOString()],
      );
      if (claim.rowCount === 0) {
        const previous = await client.query(
          `SELECT request_hash, response_status, response_body
             FROM droneworks.api_idempotency_requests
            WHERE user_id = $1
              AND operation = $2
              AND idempotency_key = $3
            FOR UPDATE`,
          [userId, operation, idempotencyKey],
        );
        const saved = previous.rows[0];
        if (saved.request_hash !== requestHash) {
          return { kind: "conflict" };
        }
        if (saved.response_status !== 201 || saved.response_body === null) {
          throw new Error("idempotent request is incomplete");
        }
        return { kind: "replayed", batch: saved.response_body };
      }

      const batchId = requireId(input.createId("import-batch"), "batchId");
      const batchResult = await client.query(
        `INSERT INTO droneworks.import_batches (
           organization_id,
           id,
           uploaded_by_user_id,
           state,
           created_at
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           'uploaded',
           $3
         )
         RETURNING id, organization_id, uploaded_by_user_id, state, created_at`,
        [batchId, userId, now.toISOString()],
      );
      const items = [];
      for (const file of input.files) {
        const itemId = requireId(input.createId("import-item"), "itemId");
        const item = await client.query(
          `INSERT INTO droneworks.import_items (
             organization_id,
             id,
             import_batch_id,
             client_file_id,
             original_filename,
             state,
             created_at
           ) VALUES (
             droneworks.current_organization_id(),
             $1,
             $2,
             $3,
             $4,
             'uploaded',
             $5
           )
           RETURNING id,
                     import_batch_id,
                     client_file_id,
                     original_filename,
                     raw_source_id,
                     state,
                     created_at`,
          [
            itemId,
            batchId,
            requireId(file.clientFileId, "clientFileId"),
            file.originalFilename,
            now.toISOString(),
          ],
        );
        items.push(item.rows[0]);
      }
      const batch = { ...batchResult.rows[0], items };
      await recordAuditEvent(client, {
        userId,
        action: "import_batch.created",
        resourceType: "import_batch",
        resourceId: batchId,
        changedFields: ["state", "items"],
        metadata: { item_count: items.length },
        now,
      });
      await client.query(
        `UPDATE droneworks.api_idempotency_requests
            SET response_status = 201,
                response_body = $4,
                completed_at = $5
          WHERE user_id = $1
            AND operation = $2
            AND idempotency_key = $3`,
        [userId, operation, idempotencyKey, JSON.stringify(batch), now.toISOString()],
      );
      return { kind: "created", batch };
    },

    async findImportBatchForMember({ userId, batchId }) {
      requireId(userId, "userId");
      requireId(batchId, "batchId");
      const result = await client.query(
        `SELECT batch.id,
                batch.organization_id,
                batch.uploaded_by_user_id,
                batch.state,
                batch.created_at
           FROM droneworks.memberships AS membership
           JOIN droneworks.import_batches AS batch
             ON batch.organization_id = membership.organization_id
          WHERE membership.user_id = $1
            AND batch.id = $2
            AND (
              membership.role IN ('owner', 'admin')
              OR batch.uploaded_by_user_id = membership.user_id
            )
          FOR KEY SHARE OF membership, batch`,
        [userId, batchId],
      );
      const batch = result.rows[0];
      if (batch === undefined) {
        return null;
      }
      const items = await client.query(
        `SELECT id,
                import_batch_id,
                client_file_id,
                original_filename,
                raw_source_id,
                state,
                created_at
           FROM droneworks.import_items
          WHERE import_batch_id = $1
          ORDER BY id`,
        [batchId],
      );
      return { ...batch, items: items.rows };
    },

    async listMaintenanceSchedulesForMember({ userId, now }) {
      requireId(userId, "userId");
      requireDate(now, "now");
      const membership = await client.query(
        `SELECT 1
           FROM droneworks.memberships
          WHERE user_id = $1
          FOR KEY SHARE`,
        [userId],
      );
      if (membership.rowCount === 0) {
        return null;
      }
      return findMaintenanceSchedules(client, {
        userId,
        scheduleId: null,
        now,
      });
    },

    async findMaintenanceScheduleForMember({ userId, scheduleId, now }) {
      const schedules = await findMaintenanceSchedules(client, {
        userId,
        scheduleId,
        now,
      });
      return schedules[0] ?? null;
    },

    async createMaintenanceScheduleForManager(input) {
      const userId = requireId(input.userId, "userId");
      const aircraftId = requireId(input.aircraftId, "aircraftId");
      const idempotencyKey = requireId(input.idempotencyKey, "idempotencyKey");
      const requestHash = requireId(input.requestHash, "requestHash");
      const now = requireDate(input.now, "now");
      const baselineAt = requireDate(input.baselineAt, "baselineAt");
      if (typeof input.createId !== "function") {
        throw new TypeError("createId must be a function");
      }
      if (typeof input.title !== "string" || input.title.trim().length === 0) {
        throw new TypeError("title must be a non-empty string");
      }
      if (![
        "flight_hours",
        "flight_count",
        "one_shot_date",
      ].includes(input.scheduleType)) {
        throw new TypeError("scheduleType is invalid");
      }
      const membership = await client.query(
        `SELECT role
           FROM droneworks.memberships
          WHERE user_id = $1
            AND role IN ('owner', 'admin')
          FOR KEY SHARE`,
        [userId],
      );
      if (membership.rowCount === 0) {
        return null;
      }
      const aircraft = await client.query(
        `SELECT id
           FROM droneworks.aircraft
          WHERE id = $1
          FOR KEY SHARE`,
        [aircraftId],
      );
      if (aircraft.rowCount === 0) {
        return null;
      }

      const operation = "create_maintenance_schedule";
      const claim = await client.query(
        `INSERT INTO droneworks.api_idempotency_requests (
           organization_id,
           user_id,
           operation,
           idempotency_key,
           request_hash,
           created_at
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           $3,
           $4,
           $5
         )
         ON CONFLICT DO NOTHING
         RETURNING request_hash`,
        [userId, operation, idempotencyKey, requestHash, now.toISOString()],
      );
      if (claim.rowCount === 0) {
        const previous = await client.query(
          `SELECT request_hash, response_status, response_body
             FROM droneworks.api_idempotency_requests
            WHERE user_id = $1
              AND operation = $2
              AND idempotency_key = $3
            FOR UPDATE`,
          [userId, operation, idempotencyKey],
        );
        const saved = previous.rows[0];
        if (saved.request_hash !== requestHash) {
          return { kind: "conflict" };
        }
        if (saved.response_status !== 201 || saved.response_body === null) {
          throw new Error("idempotent request is incomplete");
        }
        return { kind: "replayed", schedule: saved.response_body };
      }

      const scheduleId = requireId(
        input.createId("maintenance-schedule"),
        "scheduleId",
      );
      await client.query(
        `INSERT INTO droneworks.maintenance_schedules (
           organization_id,
           id,
           aircraft_id,
           title,
           schedule_type,
           interval_value,
           due_at,
           baseline_at,
           due_soon_threshold_percent,
           due_soon_days,
           created_by_user_id,
           created_at
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11
         )`,
        [
          scheduleId,
          aircraftId,
          input.title.trim(),
          input.scheduleType,
          input.intervalValue,
          input.dueAt?.toISOString() ?? null,
          baselineAt.toISOString(),
          input.dueSoonThresholdPercent,
          input.dueSoonDays,
          userId,
          now.toISOString(),
        ],
      );
      const [schedule] = await findMaintenanceSchedules(client, {
        userId,
        scheduleId,
        now,
      });
      await recordAuditEvent(client, {
        userId,
        action: "maintenance_schedule.created",
        resourceType: "maintenance_schedule",
        resourceId: scheduleId,
        changedFields: [
          "aircraft_id",
          "title",
          "schedule_type",
          "baseline_at",
          "interval",
        ],
        metadata: { schedule_type: input.scheduleType },
        now,
      });
      await client.query(
        `UPDATE droneworks.api_idempotency_requests
            SET response_status = 201,
                response_body = $4,
                completed_at = $5
          WHERE user_id = $1
            AND operation = $2
            AND idempotency_key = $3`,
        [
          userId,
          operation,
          idempotencyKey,
          JSON.stringify(schedule),
          now.toISOString(),
        ],
      );
      return { kind: "created", schedule };
    },

    async completeMaintenanceScheduleForManager(input) {
      const userId = requireId(input.userId, "userId");
      const scheduleId = requireId(input.scheduleId, "scheduleId");
      const idempotencyKey = requireId(input.idempotencyKey, "idempotencyKey");
      const requestHash = requireId(input.requestHash, "requestHash");
      const completedAt = requireDate(input.completedAt, "completedAt");
      const now = requireDate(input.now, "now");
      if (typeof input.createId !== "function") {
        throw new TypeError("createId must be a function");
      }
      if (typeof input.details !== "string" || input.details.trim().length === 0) {
        throw new TypeError("details must be a non-empty string");
      }
      const target = await client.query(
        `SELECT schedule.baseline_at
           FROM droneworks.memberships AS membership
           JOIN droneworks.maintenance_schedules AS schedule
             ON schedule.organization_id = membership.organization_id
          WHERE membership.user_id = $1
            AND membership.role IN ('owner', 'admin')
            AND schedule.id = $2
          FOR KEY SHARE OF membership`,
        [userId, scheduleId],
      );
      if (target.rowCount === 0) {
        return null;
      }

      const operation = `complete_maintenance_schedule:${scheduleId}`;
      const claim = await client.query(
        `INSERT INTO droneworks.api_idempotency_requests (
           organization_id,
           user_id,
           operation,
           idempotency_key,
           request_hash,
           created_at
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           $3,
           $4,
           $5
         )
         ON CONFLICT DO NOTHING
         RETURNING request_hash`,
        [userId, operation, idempotencyKey, requestHash, now.toISOString()],
      );
      if (claim.rowCount === 0) {
        const previous = await client.query(
          `SELECT request_hash, response_status, response_body
             FROM droneworks.api_idempotency_requests
            WHERE user_id = $1
              AND operation = $2
              AND idempotency_key = $3
            FOR UPDATE`,
          [userId, operation, idempotencyKey],
        );
        const saved = previous.rows[0];
        if (saved.request_hash !== requestHash) {
          return { kind: "conflict" };
        }
        if (saved.response_status !== 201 || saved.response_body === null) {
          throw new Error("idempotent request is incomplete");
        }
        return { kind: "replayed", result: saved.response_body };
      }

      const latest = await client.query(
        `SELECT completed_at
           FROM droneworks.maintenance_completions
          WHERE maintenance_schedule_id = $1
          ORDER BY completed_at DESC, id DESC
          LIMIT 1`,
        [scheduleId],
      );
      const priorBaseline = latest.rows[0]?.completed_at
        ?? target.rows[0].baseline_at;
      if (completedAt <= priorBaseline || completedAt > now) {
        throw new TypeError(
          "completedAt must be after the current baseline and not in the future",
        );
      }
      const completionId = requireId(
        input.createId("maintenance-completion"),
        "completionId",
      );
      const inserted = await client.query(
        `INSERT INTO droneworks.maintenance_completions (
           organization_id,
           id,
           maintenance_schedule_id,
           completed_by_user_id,
           completed_at,
           details,
           recorded_at
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           $3,
           $4,
           $5,
           $6
         )
         RETURNING id,
                   organization_id,
                   maintenance_schedule_id,
                   completed_by_user_id,
                   completed_at,
                   details,
                   recorded_at`,
        [
          completionId,
          scheduleId,
          userId,
          completedAt.toISOString(),
          input.details.trim(),
          now.toISOString(),
        ],
      );
      const [schedule] = await findMaintenanceSchedules(client, {
        userId,
        scheduleId,
        now,
      });
      const responseBody = {
        completion: inserted.rows[0],
        schedule,
      };
      await recordAuditEvent(client, {
        userId,
        action: "maintenance_schedule.completed",
        resourceType: "maintenance_completion",
        resourceId: completionId,
        changedFields: ["completed_at", "details"],
        metadata: { maintenance_schedule_id: scheduleId },
        now,
      });
      await client.query(
        `UPDATE droneworks.api_idempotency_requests
            SET response_status = 201,
                response_body = $4,
                completed_at = $5
          WHERE user_id = $1
            AND operation = $2
            AND idempotency_key = $3`,
        [
          userId,
          operation,
          idempotencyKey,
          JSON.stringify(responseBody),
          now.toISOString(),
        ],
      );
      return { kind: "created", result: responseBody };
    },

    async createOrganizationExportForManager(input) {
      const userId = requireId(input.userId, "userId");
      const idempotencyKey = requireId(input.idempotencyKey, "idempotencyKey");
      const requestHash = requireId(input.requestHash, "requestHash");
      const now = requireDate(input.now, "now");
      if (typeof input.createId !== "function") {
        throw new TypeError("createId must be a function");
      }
      const membership = await client.query(
        `SELECT role
           FROM droneworks.memberships
          WHERE user_id = $1
            AND role IN ('owner', 'admin')
          FOR KEY SHARE`,
        [userId],
      );
      if (membership.rowCount === 0) {
        return null;
      }

      const operation = "create_organization_export";
      const claim = await client.query(
        `INSERT INTO droneworks.api_idempotency_requests (
           organization_id,
           user_id,
           operation,
           idempotency_key,
           request_hash,
           created_at
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           $3,
           $4,
           $5
         )
         ON CONFLICT DO NOTHING
         RETURNING request_hash`,
        [userId, operation, idempotencyKey, requestHash, now.toISOString()],
      );
      if (claim.rowCount === 0) {
        const previous = await client.query(
          `SELECT request_hash, response_status, response_body
             FROM droneworks.api_idempotency_requests
            WHERE user_id = $1
              AND operation = $2
              AND idempotency_key = $3
            FOR UPDATE`,
          [userId, operation, idempotencyKey],
        );
        const saved = previous.rows[0];
        if (saved.request_hash !== requestHash) {
          return { kind: "conflict" };
        }
        if (saved.response_status !== 202 || saved.response_body === null) {
          throw new Error("idempotent request is incomplete");
        }
        return { kind: "replayed", exportRequest: saved.response_body };
      }

      const exportRequestId = requireId(
        input.createId("organization-export"),
        "exportRequestId",
      );
      const manifest = await buildOrganizationExportManifest(client, now);
      const inserted = await client.query(
        `INSERT INTO droneworks.organization_export_requests (
           organization_id,
           id,
           requested_by_user_id,
           state,
           manifest_version,
           manifest,
           requested_at
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           'queued',
           1,
           $3,
           $4
         )
         RETURNING id,
                   organization_id,
                   requested_by_user_id,
                   state,
                   manifest_version,
                   manifest,
                   requested_at,
                   export_artifact_id,
                   completed_at`,
        [exportRequestId, userId, JSON.stringify(manifest), now.toISOString()],
      );
      const exportRequest = inserted.rows[0];
      await client.query(
        `SELECT droneworks_jobs.enqueue_outbox(
           $1,
           'organization-export-v1',
           $2,
           NULL,
           $3,
           $3
         )`,
        [
          `outbox:organization-export:${exportRequestId}`,
          exportRequestId,
          now.toISOString(),
        ],
      );
      await recordAuditEvent(client, {
        userId,
        action: "organization_export.requested",
        resourceType: "organization_export",
        resourceId: exportRequestId,
        changedFields: ["state", "manifest"],
        metadata: { manifest_version: 1 },
        now,
      });
      await client.query(
        `UPDATE droneworks.api_idempotency_requests
            SET response_status = 202,
                response_body = $4,
                completed_at = $5
          WHERE user_id = $1
            AND operation = $2
            AND idempotency_key = $3`,
        [
          userId,
          operation,
          idempotencyKey,
          JSON.stringify(exportRequest),
          now.toISOString(),
        ],
      );
      return { kind: "created", exportRequest };
    },

    async cancelPendingOutbox(outboxId) {
      requireId(outboxId, "outboxId");
      const result = await client.query(
        "SELECT droneworks_jobs.cancel_pending_outbox($1) AS cancelled",
        [outboxId],
      );
      return result.rows[0].cancelled;
    },

    async findOrganizationExportForManager({ userId, exportRequestId }) {
      requireId(userId, "userId");
      requireId(exportRequestId, "exportRequestId");
      const result = await client.query(
        `SELECT request.id,
                request.organization_id,
                request.requested_by_user_id,
                request.state,
                request.manifest_version,
                request.manifest,
                request.requested_at,
                request.export_artifact_id,
                request.completed_at
           FROM droneworks.memberships AS membership
           JOIN droneworks.organization_export_requests AS request
             ON request.organization_id = membership.organization_id
          WHERE membership.user_id = $1
            AND membership.role IN ('owner', 'admin')
            AND request.id = $2
          FOR KEY SHARE OF membership, request`,
        [userId, exportRequestId],
      );
      return result.rows[0] ?? null;
    },

    async findOrganizationExportById(exportRequestId) {
      requireId(exportRequestId, "exportRequestId");
      const result = await client.query(
        `SELECT id,
                organization_id,
                requested_by_user_id,
                state,
                manifest_version,
                manifest,
                requested_at,
                export_artifact_id,
                completed_at
           FROM droneworks.organization_export_requests
          WHERE id = $1
          FOR KEY SHARE`,
        [exportRequestId],
      );
      return result.rows[0] ?? null;
    },

    async lockOrganizationExportForGeneration(exportRequestId) {
      requireId(exportRequestId, "exportRequestId");
      const result = await client.query(
        `SELECT request.id,
                request.organization_id,
                request.requested_by_user_id,
                request.state,
                request.manifest_version,
                request.manifest,
                request.requested_at,
                request.export_artifact_id,
                request.completed_at,
                artifact.object_artifact_id,
                artifact.state AS artifact_state,
                artifact.available_until
           FROM droneworks.organization_export_requests AS request
           LEFT JOIN droneworks.export_artifacts AS artifact
             ON artifact.organization_id = request.organization_id
            AND artifact.id = request.export_artifact_id
          WHERE request.id = $1
          FOR UPDATE OF request`,
        [exportRequestId],
      );
      return result.rows[0] ?? null;
    },

    async finalizeOrganizationExport(input) {
      const exportRequestId = requireId(
        input.exportRequestId,
        "exportRequestId",
      );
      const artifactId = requireId(input.artifactId, "artifactId");
      const objectArtifactId = requireId(
        input.objectArtifactId,
        "objectArtifactId",
      );
      const requestedByUserId = requireId(
        input.requestedByUserId,
        "requestedByUserId",
      );
      const bundleSha256 = requireId(input.bundleSha256, "bundleSha256");
      const now = requireDate(input.now, "now");
      const availableUntil = requireDate(
        input.availableUntil,
        "availableUntil",
      );
      if (!Number.isSafeInteger(input.fileCount) || input.fileCount <= 0) {
        throw new TypeError("fileCount must be a positive integer");
      }
      await client.query(
        `UPDATE droneworks.organization_export_requests
            SET state = 'processing'
          WHERE id = $1
            AND state = 'queued'`,
        [exportRequestId],
      );
      await client.query(
        `INSERT INTO droneworks.export_artifacts (
           organization_id,
           id,
           object_artifact_id,
           state,
           available_until
         ) VALUES (
           droneworks.current_organization_id(),
           $1,
           $2,
           'ready',
           $3
         )
         ON CONFLICT (organization_id, id) DO NOTHING`,
        [artifactId, objectArtifactId, availableUntil.toISOString()],
      );
      const artifact = await client.query(
        `SELECT id,
                organization_id,
                object_artifact_id,
                state,
                available_until
           FROM droneworks.export_artifacts
          WHERE id = $1`,
        [artifactId],
      );
      const artifactRow = artifact.rows[0];
      if (artifactRow === undefined
          || artifactRow.object_artifact_id !== objectArtifactId
          || artifactRow.state !== "ready") {
        throw new Error("organization export artifact identity conflicts");
      }
      const updated = await client.query(
        `UPDATE droneworks.organization_export_requests
            SET state = 'ready',
                export_artifact_id = $2,
                completed_at = $3
          WHERE id = $1
            AND state = 'processing'
          RETURNING id,
                    organization_id,
                    requested_by_user_id,
                    state,
                    manifest_version,
                    manifest,
                    requested_at,
                    export_artifact_id,
                    completed_at`,
        [exportRequestId, artifactId, now.toISOString()],
      );
      const exportRequest = updated.rows[0];
      if (exportRequest === undefined) {
        throw new Error("organization export request did not transition to ready");
      }
      await recordAuditEvent(client, {
        userId: requestedByUserId,
        action: "organization_export.completed",
        resourceType: "organization_export",
        resourceId: exportRequestId,
        changedFields: ["state", "export_artifact_id", "completed_at"],
        metadata: {
          manifest_version: exportRequest.manifest_version,
          bundle_sha256: bundleSha256,
          file_count: input.fileCount,
        },
        now,
      });
      return {
        exportRequest,
        artifact: artifactRow,
      };
    },

    async findDownloadableObject({ userId, resourceType, resourceId, now }) {
      requireId(userId, "userId");
      requireId(resourceId, "resourceId");
      if (!["raw_source", "export"].includes(resourceType)) {
        throw new TypeError("resourceType must be raw_source or export");
      }
      if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
        throw new TypeError("now must be a valid Date");
      }

      const resourceQuery = resourceType === "raw_source"
        ? `SELECT r.organization_id,
                  r.id AS resource_id,
                  r.object_revision_id AS object_component
             FROM droneworks.memberships AS m
             JOIN droneworks.organizations AS o
               ON o.id = m.organization_id
             JOIN droneworks.raw_sources AS r
               ON r.organization_id = m.organization_id
            WHERE m.user_id = $1
              AND r.id = $2
              AND r.state = 'retained'
              AND (
                m.role IN ('owner', 'admin')
                OR (
                  m.role = 'pilot'
                  AND o.pilot_raw_download_enabled
                  AND EXISTS (
                    SELECT 1
                      FROM droneworks.raw_source_flights AS rf
                      JOIN droneworks.canonical_flights AS f
                        ON f.organization_id = rf.organization_id
                       AND f.id = rf.canonical_flight_id
                      JOIN droneworks.pilot_profiles AS p
                        ON p.organization_id = f.organization_id
                       AND p.id = f.pilot_profile_id
                     WHERE rf.organization_id = r.organization_id
                       AND rf.raw_source_id = r.id
                       AND p.membership_user_id = m.user_id
                  )
                  AND NOT EXISTS (
                    SELECT 1
                      FROM droneworks.raw_source_flights AS rf
                      JOIN droneworks.canonical_flights AS f
                        ON f.organization_id = rf.organization_id
                       AND f.id = rf.canonical_flight_id
                      JOIN droneworks.pilot_profiles AS p
                        ON p.organization_id = f.organization_id
                       AND p.id = f.pilot_profile_id
                     WHERE rf.organization_id = r.organization_id
                       AND rf.raw_source_id = r.id
                       AND p.membership_user_id IS DISTINCT FROM m.user_id
                  )
                )
              )
            FOR KEY SHARE OF m, o, r`
        : `SELECT e.organization_id,
                  e.id AS resource_id,
                  e.object_artifact_id AS object_component
             FROM droneworks.memberships AS m
             JOIN droneworks.organizations AS o
               ON o.id = m.organization_id
             JOIN droneworks.export_artifacts AS e
               ON e.organization_id = m.organization_id
            WHERE m.user_id = $1
              AND e.id = $2
              AND e.state = 'ready'
              AND e.available_until > $3
              AND (
                m.role IN ('owner', 'admin')
                OR (
                  m.role = 'pilot'
                  AND o.pilot_export_enabled
                  AND EXISTS (
                    SELECT 1
                      FROM droneworks.export_artifact_flights AS ef
                      JOIN droneworks.canonical_flights AS f
                        ON f.organization_id = ef.organization_id
                       AND f.id = ef.canonical_flight_id
                      JOIN droneworks.pilot_profiles AS p
                        ON p.organization_id = f.organization_id
                       AND p.id = f.pilot_profile_id
                     WHERE ef.organization_id = e.organization_id
                       AND ef.export_artifact_id = e.id
                       AND p.membership_user_id = m.user_id
                  )
                  AND NOT EXISTS (
                    SELECT 1
                      FROM droneworks.export_artifact_flights AS ef
                      JOIN droneworks.canonical_flights AS f
                        ON f.organization_id = ef.organization_id
                       AND f.id = ef.canonical_flight_id
                      JOIN droneworks.pilot_profiles AS p
                        ON p.organization_id = f.organization_id
                       AND p.id = f.pilot_profile_id
                     WHERE ef.organization_id = e.organization_id
                       AND ef.export_artifact_id = e.id
                       AND p.membership_user_id IS DISTINCT FROM m.user_id
                  )
                )
              )
            FOR KEY SHARE OF m, o, e`;
      const parameters = resourceType === "raw_source"
        ? [userId, resourceId]
        : [userId, resourceId, now.toISOString()];
      const result = await client.query(resourceQuery, parameters);
      return result.rows[0] ?? null;
    },

    async revokeMembership(userId) {
      requireId(userId, "userId");
      const result = await client.query(
        `DELETE FROM droneworks.memberships
          WHERE user_id = $1
          RETURNING organization_id, user_id`,
        [userId],
      );
      return result.rows[0] ?? null;
    },
  });
}

export async function withOrganization(pool, organizationId, callback) {
  requireId(organizationId, "organizationId");
  if (typeof callback !== "function") {
    throw new TypeError("callback must be a function");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.organization_id', $1, true)",
      [organizationId],
    );
    const result = await callback(createRepositories(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadFlightForJob(pool, input) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("job input must include organizationId and flightId");
  }
  requireId(input.organizationId, "organizationId");
  requireId(input.flightId, "flightId");
  return withOrganization(pool, input.organizationId, (repositories) => (
    repositories.findFlightById(input.flightId)
  ));
}

export async function loadOrganizationExportForJob(pool, input) {
  if (input === null || typeof input !== "object") {
    throw new TypeError(
      "job input must include organizationId and exportRequestId",
    );
  }
  requireId(input.organizationId, "organizationId");
  requireId(input.exportRequestId, "exportRequestId");
  return withOrganization(pool, input.organizationId, (repositories) => (
    repositories.findOrganizationExportById(input.exportRequestId)
  ));
}
