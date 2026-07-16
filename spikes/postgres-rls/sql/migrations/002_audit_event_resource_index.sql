CREATE INDEX audit_events_resource_occurred_idx
  ON droneworks.audit_events (
    organization_id,
    resource_type,
    resource_id,
    occurred_at DESC
  );
