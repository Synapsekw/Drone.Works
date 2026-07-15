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
       'flight',
       $3,
       $4,
       $5,
       $6
     )`,
    [
      requireId(input.userId, "userId"),
      input.action,
      requireId(input.flightId, "flightId"),
      input.changedFields,
      input.metadata,
      requireDate(input.now, "now").toISOString(),
    ],
  );
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
