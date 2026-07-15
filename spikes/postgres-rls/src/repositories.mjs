function requireId(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError(`${field} must be a non-empty identifier`);
  }
  return value;
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

    async listFlightsWithAircraft() {
      const result = await client.query(
        `SELECT f.id, f.organization_id, a.display_name AS aircraft_name
           FROM droneworks.canonical_flights AS f
           JOIN droneworks.aircraft AS a
             ON a.organization_id = f.organization_id
            AND a.id = f.aircraft_id
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
           state,
           duration_ms
         ) VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING id, organization_id`,
        [
          requireId(input.organizationId, "organizationId"),
          requireId(input.flightId, "flightId"),
          requireId(input.pilotProfileId, "pilotProfileId"),
          requireId(input.aircraftId, "aircraftId"),
          input.durationMs,
        ],
      );
      return result.rows[0];
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
             JOIN droneworks.raw_sources AS r
               ON r.organization_id = m.organization_id
            WHERE m.user_id = $1
              AND m.role IN ('owner', 'admin')
              AND r.id = $2
              AND r.state = 'retained'
            FOR KEY SHARE OF m, r`
        : `SELECT e.organization_id,
                  e.id AS resource_id,
                  e.object_artifact_id AS object_component
             FROM droneworks.memberships AS m
             JOIN droneworks.export_artifacts AS e
               ON e.organization_id = m.organization_id
            WHERE m.user_id = $1
              AND m.role IN ('owner', 'admin')
              AND e.id = $2
              AND e.state = 'ready'
              AND e.available_until > $3
            FOR KEY SHARE OF m, e`;
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
