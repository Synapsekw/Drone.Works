import { Type, type Static, type TSchema } from '@sinclair/typebox';

const uuidStringSchema = Type.String({
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
});

export const healthQuerySchema = Type.Object(
  {},
  { $id: 'HealthQuery', additionalProperties: false },
);

export const healthResponseSchema = Type.Object(
  {
    status: Type.Literal('ok'),
    service: Type.Literal('api'),
    version: Type.Literal('v1'),
  },
  { $id: 'HealthResponse', additionalProperties: false },
);

export const organizationRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('pilot'),
  Type.Literal('viewer'),
]);

export const organizationPathSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
  },
  { $id: 'OrganizationPath', additionalProperties: false },
);

export const membershipPathSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
    user_id: uuidStringSchema,
  },
  { $id: 'MembershipPath', additionalProperties: false },
);

export const createOrganizationBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    default_timezone: Type.String({ minLength: 1, maxLength: 100 }),
    unit_system: Type.Union([Type.Literal('metric'), Type.Literal('imperial')]),
  },
  { $id: 'CreateOrganizationBody', additionalProperties: false },
);

export const organizationSelectionSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
    name: Type.String(),
    default_timezone: Type.String(),
    unit_system: Type.Union([Type.Literal('metric'), Type.Literal('imperial')]),
    role: organizationRoleSchema,
    pilot_profile_id: Type.Union([uuidStringSchema, Type.Null()]),
  },
  { $id: 'OrganizationSelection', additionalProperties: false },
);

export const putMembershipBodySchema = Type.Object(
  {
    role: organizationRoleSchema,
  },
  { $id: 'PutMembershipBody', additionalProperties: false },
);

export const membershipSchema = Type.Object(
  {
    user_id: uuidStringSchema,
    role: organizationRoleSchema,
    pilot_profile_id: Type.Union([uuidStringSchema, Type.Null()]),
  },
  { $id: 'Membership', additionalProperties: false },
);

export const membershipListSchema = Type.Object(
  {
    memberships: Type.Array(Type.Ref(membershipSchema)),
  },
  { $id: 'MembershipList', additionalProperties: false },
);

export const invitationRoleSchema = Type.Union([
  Type.Literal('admin'),
  Type.Literal('pilot'),
  Type.Literal('viewer'),
]);

export const invitationPathSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
    invitation_id: uuidStringSchema,
  },
  { $id: 'InvitationPath', additionalProperties: false },
);

export const createInvitationBodySchema = Type.Object(
  {
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
    }),
    role: invitationRoleSchema,
  },
  { $id: 'CreateInvitationBody', additionalProperties: false },
);

export const acceptInvitationBodySchema = Type.Object(
  {
    token: Type.String({ minLength: 43, maxLength: 128 }),
  },
  { $id: 'AcceptInvitationBody', additionalProperties: false },
);

export const invitationSchema = Type.Object(
  {
    invitation_id: uuidStringSchema,
    organization_id: uuidStringSchema,
    role: invitationRoleSchema,
    expires_at: Type.String({ format: 'date-time' }),
  },
  { $id: 'Invitation', additionalProperties: false },
);

export const rawUploadPathSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
    upload_id: uuidStringSchema,
  },
  { $id: 'RawUploadPath', additionalProperties: false },
);

export const idempotencyHeadersSchema = Type.Object(
  {
    'idempotency-key': Type.String({ minLength: 1, maxLength: 200 }),
  },
  { $id: 'IdempotencyHeaders', additionalProperties: true },
);

export const declareRawUploadBodySchema = Type.Object(
  {
    client_file_id: Type.String({ minLength: 1, maxLength: 200 }),
    original_filename: Type.String({ minLength: 1, maxLength: 500 }),
    content_sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    byte_size: Type.Integer({ minimum: 1, maximum: 33_554_432 }),
    media_type: Type.Literal('application/octet-stream'),
  },
  { $id: 'DeclareRawUploadBody', additionalProperties: false },
);

export const rawUploadDeclarationSchema = Type.Object(
  {
    upload_id: uuidStringSchema,
    state: Type.Literal('declared'),
    content_sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  },
  { $id: 'RawUploadDeclaration', additionalProperties: false },
);

export const rawUploadContentSchema = Type.Object(
  {
    upload_id: uuidStringSchema,
    object_version_id: uuidStringSchema,
    content_sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  },
  { $id: 'RawUploadContent', additionalProperties: false },
);

export const completeRawUploadBodySchema = Type.Object(
  {
    object_version_id: uuidStringSchema,
    dji_encrypted_processing: Type.Optional(Type.Literal('approved')),
  },
  { $id: 'CompleteRawUploadBody', additionalProperties: false },
);

export const rawUploadSchema = Type.Object(
  {
    upload_id: uuidStringSchema,
    raw_source_id: Type.Union([uuidStringSchema, Type.Null()]),
    object_version_id: Type.Union([uuidStringSchema, Type.Null()]),
    state: Type.Union([Type.Literal('declared'), Type.Literal('completed')]),
    content_sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  },
  { $id: 'RawUpload', additionalProperties: false },
);

export const importPathSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
    import_id: uuidStringSchema,
  },
  { $id: 'ImportPath', additionalProperties: false },
);

export const importStateSchema = Type.Union([
  Type.Literal('uploaded'),
  Type.Literal('queued'),
  Type.Literal('detecting'),
  Type.Literal('parsing'),
  Type.Literal('normalizing'),
  Type.Literal('awaiting_review'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('skipped_duplicate'),
]);

export const importFailureReasonSchema = Type.Union([
  Type.Literal('unsupported'),
  Type.Literal('corrupt'),
  Type.Literal('truncated'),
  Type.Literal('key_unavailable'),
  Type.Literal('processing_failed'),
]);

export const importStatusSchema = Type.Object(
  {
    import_id: uuidStringSchema,
    state: importStateSchema,
    failure_reason: Type.Union([importFailureReasonSchema, Type.Null()]),
    result_flight_id: Type.Union([uuidStringSchema, Type.Null()]),
    updated_at: Type.String({ format: 'date-time' }),
  },
  { $id: 'ImportStatus', additionalProperties: false },
);

export const importBatchPathSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
    batch_id: uuidStringSchema,
  },
  { $id: 'ImportBatchPath', additionalProperties: false },
);

export const importBatchListQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  },
  { $id: 'ImportBatchListQuery', additionalProperties: false },
);

export const declareImportBatchBodySchema = Type.Object(
  {
    files: Type.Array(
      Type.Object(
        {
          client_file_id: Type.String({ minLength: 1, maxLength: 200 }),
          original_filename: Type.String({ minLength: 1, maxLength: 500 }),
          content_sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
          byte_size: Type.Integer({ minimum: 1, maximum: 33_554_432 }),
          media_type: Type.Literal('application/octet-stream'),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 20 },
    ),
  },
  { $id: 'DeclareImportBatchBody', additionalProperties: false },
);

export const importBatchDeclarationItemSchema = Type.Object(
  {
    import_id: uuidStringSchema,
    client_file_id: Type.String({ minLength: 1, maxLength: 200 }),
    original_filename: Type.String({ minLength: 1, maxLength: 500 }),
    content_sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    state: Type.Literal('uploaded'),
  },
  { $id: 'ImportBatchDeclarationItem', additionalProperties: false },
);

export const importBatchDeclarationSchema = Type.Object(
  {
    batch_id: uuidStringSchema,
    items: Type.Array(Type.Ref(importBatchDeclarationItemSchema), {
      minItems: 1,
      maxItems: 20,
    }),
  },
  { $id: 'ImportBatchDeclaration', additionalProperties: false },
);

export const importOutcomeSchema = Type.Union([
  Type.Literal('supported_completion'),
  Type.Literal('unsupported'),
  Type.Literal('corrupt'),
  Type.Literal('truncated'),
  Type.Literal('key_unavailable'),
  Type.Literal('processing_failed'),
  Type.Literal('cancelled'),
  Type.Literal('exact_duplicate'),
  Type.Literal('probable_duplicate'),
]);

export const duplicateKindSchema = Type.Union([
  Type.Literal('exact_file'),
  Type.Literal('exact_normalized'),
  Type.Literal('probable'),
]);

export const importAttemptSchema = Type.Object(
  {
    attempt_number: Type.Integer({ minimum: 1 }),
    state: Type.Union([
      Type.Literal('queued'),
      Type.Literal('running'),
      Type.Literal('succeeded'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
    ]),
    failure_reason: Type.Union([importFailureReasonSchema, Type.Null()]),
    started_at: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    finished_at: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
  },
  { $id: 'ImportAttempt', additionalProperties: false },
);

export const importBatchItemSchema = Type.Object(
  {
    import_id: uuidStringSchema,
    original_filename: Type.String({ minLength: 1, maxLength: 500 }),
    state: importStateSchema,
    progress_percent: Type.Integer({ minimum: 0, maximum: 100 }),
    outcome: Type.Union([importOutcomeSchema, Type.Null()]),
    failure_reason: Type.Union([importFailureReasonSchema, Type.Null()]),
    duplicate_kind: Type.Union([duplicateKindSchema, Type.Null()]),
    result_flight_id: Type.Union([uuidStringSchema, Type.Null()]),
    related_flight_id: Type.Union([uuidStringSchema, Type.Null()]),
    retry_eligible: Type.Boolean(),
    attempts: Type.Array(Type.Ref(importAttemptSchema), { maxItems: 20 }),
    updated_at: Type.String({ format: 'date-time' }),
  },
  { $id: 'ImportBatchItem', additionalProperties: false },
);

export const importBatchSummarySchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    processing: Type.Integer({ minimum: 0 }),
    completed: Type.Integer({ minimum: 0 }),
    awaiting_review: Type.Integer({ minimum: 0 }),
    duplicates: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    cancelled: Type.Integer({ minimum: 0 }),
  },
  { $id: 'ImportBatchSummary', additionalProperties: false },
);

export const importBatchSchema = Type.Object(
  {
    batch_id: uuidStringSchema,
    state: Type.Union([Type.Literal('processing'), Type.Literal('completed')]),
    created_at: Type.String({ format: 'date-time' }),
    summary: Type.Ref(importBatchSummarySchema),
    items: Type.Array(Type.Ref(importBatchItemSchema), { maxItems: 20 }),
  },
  { $id: 'ImportBatch', additionalProperties: false },
);

export const importBatchListSchema = Type.Object(
  {
    batches: Type.Array(Type.Ref(importBatchSchema), { maxItems: 20 }),
  },
  { $id: 'ImportBatchList', additionalProperties: false },
);

export const flightPathSchema = Type.Object(
  {
    organization_id: uuidStringSchema,
    flight_id: uuidStringSchema,
  },
  { $id: 'FlightPath', additionalProperties: false },
);

export const flightFactOriginSchema = Type.Union([
  Type.Literal('imported'),
  Type.Literal('derived'),
  Type.Literal('user_override'),
  Type.Literal('unavailable'),
]);

const nullableStringSchema = Type.Union([
  Type.String({ maxLength: 500 }),
  Type.Null(),
]);
const nullableNumberSchema = Type.Union([Type.Number(), Type.Null()]);
const nullableIntegerSchema = Type.Union([
  Type.Integer({ minimum: 0 }),
  Type.Null(),
]);

function factSchema(value: TSchema) {
  return Type.Object(
    { origin: flightFactOriginSchema, value },
    { additionalProperties: false },
  );
}

export const flightFactsSchema = Type.Object(
  {
    aircraft_model: factSchema(nullableStringSchema),
    aircraft_name: factSchema(nullableStringSchema),
    application_platform: factSchema(nullableStringSchema),
    application_version: factSchema(nullableStringSchema),
    distance_m: factSchema(nullableNumberSchema),
    duration_ms: factSchema(nullableNumberSchema),
    max_height_m: factSchema(nullableNumberSchema),
    max_horizontal_speed_mps: factSchema(nullableNumberSchema),
    max_vertical_speed_mps: factSchema(nullableNumberSchema),
    takeoff_time_utc: factSchema(nullableStringSchema),
  },
  { $id: 'FlightFacts', additionalProperties: false },
);

export const flightTelemetrySummarySchema = Type.Object(
  {
    sample_count: Type.Integer({ minimum: 0 }),
    first_elapsed_ms: nullableIntegerSchema,
    last_elapsed_ms: nullableIntegerSchema,
  },
  { $id: 'FlightTelemetrySummary', additionalProperties: false },
);

export const flightSummarySchema = Type.Object(
  {
    flight_id: uuidStringSchema,
    state: Type.Union([
      Type.Literal('active'),
      Type.Literal('awaiting_review'),
    ]),
    assignment_status: Type.Union([
      Type.Literal('assigned'),
      Type.Literal('awaiting_pilot'),
      Type.Literal('awaiting_aircraft'),
      Type.Literal('ambiguous_aircraft'),
      Type.Literal('awaiting_time'),
      Type.Literal('awaiting_multiple'),
    ]),
    source_kind: Type.Union([Type.Literal('imported'), Type.Literal('manual')]),
    pilot_profile_id: Type.Union([uuidStringSchema, Type.Null()]),
    pilot_display_name: Type.Union([
      Type.String({ minLength: 1, maxLength: 200 }),
      Type.Null(),
    ]),
    proposed_pilot_profile_id: Type.Union([uuidStringSchema, Type.Null()]),
    aircraft_id: Type.Union([uuidStringSchema, Type.Null()]),
    aircraft_display_name: Type.Union([
      Type.String({ minLength: 1, maxLength: 200 }),
      Type.Null(),
    ]),
    takeoff_timezone: Type.String({ minLength: 1, maxLength: 100 }),
    revision_number: Type.Integer({ minimum: 1 }),
    capabilities: Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 32,
      uniqueItems: true,
    }),
    facts: Type.Ref(flightFactsSchema),
    telemetry: Type.Union([
      Type.Ref(flightTelemetrySummarySchema),
      Type.Null(),
    ]),
  },
  { $id: 'FlightSummary', additionalProperties: false },
);

export const flightListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9_-]{1,200}$' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    search: Type.Optional(Type.String({ maxLength: 100 })),
    state: Type.Optional(
      Type.Union([Type.Literal('active'), Type.Literal('awaiting_review')]),
    ),
  },
  { $id: 'FlightListQuery', additionalProperties: false },
);

export const flightListTotalsSchema = Type.Object(
  {
    active_flights: Type.Integer({ minimum: 0 }),
    awaiting_review: Type.Integer({ minimum: 0 }),
    total_distance_m: Type.Number({ minimum: 0 }),
    total_duration_ms: Type.Number({ minimum: 0 }),
  },
  { $id: 'FlightListTotals', additionalProperties: false },
);

export const flightListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(flightSummarySchema), { maxItems: 100 }),
    next_cursor: Type.Union([Type.String(), Type.Null()]),
    totals: Type.Ref(flightListTotalsSchema),
  },
  { $id: 'FlightList', additionalProperties: false },
);

export const flightTrackQuerySchema = Type.Object(
  {
    mode: Type.Optional(
      Type.Union([Type.Literal('default'), Type.Literal('full')]),
    ),
    cursor: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9_-]{1,200}$' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000 })),
  },
  { $id: 'FlightTrackQuery', additionalProperties: false },
);

export const flightTrackPointSchema = Type.Object(
  {
    sample_index: Type.Integer({ minimum: 0 }),
    elapsed_ms: nullableIntegerSchema,
    position: Type.Union([
      Type.Object(
        {
          latitude_deg: Type.Number({ minimum: -90, maximum: 90 }),
          longitude_deg: Type.Number({ minimum: -180, maximum: 180 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    altitude_msl_m: nullableNumberSchema,
    height_agl_m: nullableNumberSchema,
    horizontal_speed_mps: nullableNumberSchema,
    vertical_speed_mps: nullableNumberSchema,
    battery_charge_percent: nullableNumberSchema,
    gps_satellites: nullableIntegerSchema,
    gps_signal_level: nullableIntegerSchema,
    signal_downlink_percent: nullableNumberSchema,
    signal_uplink_percent: nullableNumberSchema,
  },
  { $id: 'FlightTrackPoint', additionalProperties: false },
);

export const flightTelemetryRangeSchema = Type.Object(
  { minimum: nullableNumberSchema, maximum: nullableNumberSchema },
  { $id: 'FlightTelemetryRange', additionalProperties: false },
);

export const flightTrackStatisticsSchema = Type.Object(
  {
    altitude_msl_m: Type.Ref(flightTelemetryRangeSchema),
    battery_charge_percent: Type.Ref(flightTelemetryRangeSchema),
    height_agl_m: Type.Ref(flightTelemetryRangeSchema),
    horizontal_speed_mps: Type.Ref(flightTelemetryRangeSchema),
    vertical_speed_mps: Type.Ref(flightTelemetryRangeSchema),
  },
  { $id: 'FlightTrackStatistics', additionalProperties: false },
);

export const flightTrackSchema = Type.Object(
  {
    flight_id: uuidStringSchema,
    revision_number: Type.Integer({ minimum: 1 }),
    mode: Type.Union([Type.Literal('default'), Type.Literal('full')]),
    capabilities: Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 32,
      uniqueItems: true,
    }),
    source_sample_count: Type.Integer({ minimum: 0 }),
    returned_sample_count: Type.Integer({ minimum: 0, maximum: 2_000 }),
    next_cursor: Type.Union([Type.String(), Type.Null()]),
    gap_transition_count: Type.Integer({ minimum: 0 }),
    preserved_gap_transition_count: Type.Integer({ minimum: 0 }),
    statistics: Type.Ref(flightTrackStatisticsSchema),
    samples: Type.Array(Type.Ref(flightTrackPointSchema), { maxItems: 2_000 }),
  },
  { $id: 'FlightTrack', additionalProperties: false },
);

export const problemErrorSchema = Type.Object(
  {
    pointer: Type.String(),
    message: Type.String(),
  },
  { $id: 'ProblemError', additionalProperties: false },
);

export const problemDetailSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.String(),
    instance: Type.String(),
    correlation_id: Type.String(),
    errors: Type.Optional(Type.Array(Type.Ref(problemErrorSchema))),
  },
  { $id: 'ProblemDetail', additionalProperties: false },
);

export type HealthResponse = Static<typeof healthResponseSchema>;
export type ProblemDetail = Static<typeof problemDetailSchema>;
export type CreateOrganizationBody = Static<
  typeof createOrganizationBodySchema
>;
export type OrganizationPath = Static<typeof organizationPathSchema>;
export type MembershipPath = Static<typeof membershipPathSchema>;
export type PutMembershipBody = Static<typeof putMembershipBodySchema>;
export type InvitationPath = Static<typeof invitationPathSchema>;
export type CreateInvitationBody = Static<typeof createInvitationBodySchema>;
export type AcceptInvitationBody = Static<typeof acceptInvitationBodySchema>;
export type RawUploadPath = Static<typeof rawUploadPathSchema>;
export type DeclareRawUploadBody = Static<typeof declareRawUploadBodySchema>;
export type CompleteRawUploadBody = Static<typeof completeRawUploadBodySchema>;
export type ImportPath = Static<typeof importPathSchema>;
export type ImportBatchPath = Static<typeof importBatchPathSchema>;
export type ImportBatchListQuery = Static<typeof importBatchListQuerySchema>;
export type DeclareImportBatchBody = Static<
  typeof declareImportBatchBodySchema
>;
export type FlightPath = Static<typeof flightPathSchema>;
export type FlightListQuery = Static<typeof flightListQuerySchema>;
export type FlightTrackQuery = Static<typeof flightTrackQuerySchema>;
