export const ORGANIZATION_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

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

function receiptFromRow(row) {
  return Object.freeze({
    status: row.outcome,
    organizationId: row.organization_id,
    deletionRequestedAt: row.deletion_requested_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    backupRetentionUntil: row.backup_retention_until?.toISOString() ?? null,
    rawObjectCount: row.raw_object_count,
    exportObjectCount: row.export_object_count,
  });
}

export async function permanentlyDeleteOrganization(pool, input, options = {}) {
  if (pool === null || typeof pool?.connect !== "function") {
    throw new TypeError("pool.connect must be a function");
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("organization deletion input is required");
  }
  const organizationId = requireId(input.organizationId, "organizationId");
  const deletionRequestedAt = requireDate(
    input.deletionRequestedAt,
    "deletionRequestedAt",
  );
  const now = requireDate(options.now ?? new Date(), "now");
  const maximumBackupRetentionDays = options.maximumBackupRetentionDays;
  if (!Number.isSafeInteger(maximumBackupRetentionDays)
      || maximumBackupRetentionDays < 0
      || maximumBackupRetentionDays > 3650) {
    throw new TypeError(
      "maximumBackupRetentionDays must be an integer between 0 and 3650",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT outcome,
              organization_id,
              deletion_requested_at,
              completed_at,
              backup_retention_until,
              raw_object_count,
              export_object_count
         FROM droneworks.permanently_delete_organization($1, $2, $3, $4)`,
      [
        organizationId,
        deletionRequestedAt.toISOString(),
        now.toISOString(),
        maximumBackupRetentionDays,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error("permanent organization deletion returned no outcome");
    }
    await client.query("COMMIT");
    return receiptFromRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
