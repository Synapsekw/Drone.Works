const featurePointLabels = [
  'BaseFeature',
  'VisionFeature',
  'WaypointFeature',
  'AgricultureFeature',
  'AirLinkFeature',
  'AfterSalesFeature',
  'DJIFlyCustomFeature',
  'PlaintextFeature',
  'FlightHubFeature',
  'GimbalFeature',
  'RCFeature',
  'CameraFeature',
  'BatteryFeature',
  'FlySafeFeature',
  'SecurityFeature',
] as const;

const featurePoints = new Set<string>([
  ...featurePointLabels,
  ...featurePointLabels.map((label, index) => {
    const name = label.slice(0, -'Feature'.length);
    return `FR_Standardization_Feature_${name}_${index + 1}`;
  }),
]);

const maximumGroups = 256;
const maximumFeaturesPerGroup = 128;
const maximumPayloadBytes = 256 * 1024;

export interface KeychainRequestPoint {
  readonly aesCiphertext: string;
  readonly featurePoint: string;
}

export interface KeychainRequest {
  readonly department: number;
  readonly keychainsArray: readonly (readonly KeychainRequestPoint[])[];
  readonly version: number;
}

export interface KeychainResponsePoint {
  readonly aesIv: string;
  readonly aesKey: string;
  readonly featurePoint: string;
}

export type KeychainResponse = readonly (readonly KeychainResponsePoint[])[];

export interface KeychainPayloadMetadata {
  readonly featurePoints: number;
  readonly groups: number;
  readonly serializedBytes: number;
}

export interface KeychainRequestMetadata extends KeychainPayloadMetadata {
  readonly department: number;
  readonly requestVersion: number;
}

type ValidationResult<Metadata> =
  | Readonly<{ metadata: Metadata; valid: true }>
  | Readonly<{
      code: 'invalid_keychain_request' | 'invalid_keychain_response';
      valid: false;
    }>;

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function canonicalBase64(
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumBytes * 2 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64');
  try {
    return (
      decoded.length >= minimumBytes &&
      decoded.length <= maximumBytes &&
      decoded.toString('base64').replaceAll('=', '') ===
        value.replaceAll('=', '')
    );
  } finally {
    decoded.fill(0);
  }
}

function serializedBytes(value: unknown): number | null {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    return bytes <= maximumPayloadBytes ? bytes : null;
  } catch {
    return null;
  }
}

export function validateKeychainRequest(
  value: unknown,
): ValidationResult<KeychainRequestMetadata> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { code: 'invalid_keychain_request', valid: false };
  }
  const request = value as Record<string, unknown>;
  if (
    !boundedInteger(request.version, 0, 255) ||
    !boundedInteger(request.department, 0, 255) ||
    !Array.isArray(request.keychainsArray) ||
    request.keychainsArray.length === 0 ||
    request.keychainsArray.length > maximumGroups
  ) {
    return { code: 'invalid_keychain_request', valid: false };
  }
  let pointCount = 0;
  for (const group of request.keychainsArray) {
    if (
      !Array.isArray(group) ||
      group.length === 0 ||
      group.length > maximumFeaturesPerGroup
    ) {
      return { code: 'invalid_keychain_request', valid: false };
    }
    pointCount += group.length;
    for (const point of group) {
      if (
        !point ||
        typeof point !== 'object' ||
        Array.isArray(point) ||
        !featurePoints.has(
          (point as Record<string, unknown>).featurePoint as string,
        ) ||
        !canonicalBase64(
          (point as Record<string, unknown>).aesCiphertext,
          1,
          4096,
        )
      ) {
        return { code: 'invalid_keychain_request', valid: false };
      }
    }
  }
  const bytes = serializedBytes(value);
  if (bytes === null) return { code: 'invalid_keychain_request', valid: false };
  return {
    metadata: {
      department: request.department,
      featurePoints: pointCount,
      groups: request.keychainsArray.length,
      requestVersion: request.version,
      serializedBytes: bytes,
    },
    valid: true,
  };
}

export function validateKeychainResponse(
  value: unknown,
): ValidationResult<KeychainPayloadMetadata> {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximumGroups
  ) {
    return { code: 'invalid_keychain_response', valid: false };
  }
  let pointCount = 0;
  for (const group of value) {
    if (
      !Array.isArray(group) ||
      group.length === 0 ||
      group.length > maximumFeaturesPerGroup
    ) {
      return { code: 'invalid_keychain_response', valid: false };
    }
    pointCount += group.length;
    for (const point of group) {
      if (
        !point ||
        typeof point !== 'object' ||
        Array.isArray(point) ||
        !featurePoints.has(
          (point as Record<string, unknown>).featurePoint as string,
        ) ||
        !canonicalBase64((point as Record<string, unknown>).aesKey, 16, 64) ||
        !canonicalBase64((point as Record<string, unknown>).aesIv, 12, 32)
      ) {
        return { code: 'invalid_keychain_response', valid: false };
      }
    }
  }
  const bytes = serializedBytes(value);
  if (bytes === null)
    return { code: 'invalid_keychain_response', valid: false };
  return {
    metadata: {
      featurePoints: pointCount,
      groups: value.length,
      serializedBytes: bytes,
    },
    valid: true,
  };
}

export type KeychainFailureCode =
  | 'invalid_keychain_request'
  | 'invalid_keychain_response'
  | 'key_rejected'
  | 'key_service_not_authorized'
  | 'key_service_rate_limited'
  | 'key_service_unavailable'
  | 'keychain_use_not_authorized';

export class KeychainProviderError extends Error {
  readonly code: KeychainFailureCode;

  constructor(code: KeychainFailureCode) {
    super(code);
    this.name = 'KeychainProviderError';
    this.code = code;
  }
}

export interface KeychainProvider {
  readonly id: string;
  fetchKeychains(
    input: Readonly<{
      request: KeychainRequest;
      requestMetadata: KeychainRequestMetadata;
    }>,
  ): Promise<KeychainResponse>;
}

export class DisabledKeychainProvider implements KeychainProvider {
  readonly id = 'disabled';

  async fetchKeychains(): Promise<KeychainResponse> {
    throw new KeychainProviderError('key_service_not_authorized');
  }
}

export interface KeychainContext {
  readonly logVersion: number;
  readonly organizationId: string;
  readonly parserId: string;
  readonly rawSourceId: string;
}

export interface KeychainAuthorization {
  readonly externalServiceProcessingAuthorized: boolean;
  readonly keychainUseAuthorized: boolean;
  readonly noticeVersion: string;
  readonly termsVersion: string;
}

export interface KeychainStore {
  authorization(
    context: KeychainContext,
  ): Promise<KeychainAuthorization | null>;
  deleteOrganization(organizationId: string): Promise<number>;
  deleteSource(organizationId: string, rawSourceId: string): Promise<number>;
  get(context: KeychainContext): Promise<KeychainResponse | null>;
  put(
    context: KeychainContext,
    keychains: KeychainResponse,
    metadata: Readonly<{
      noticeVersion: string;
      providerId: string;
      termsVersion: string;
    }>,
  ): Promise<void>;
}

export type KeychainResolutionStatus =
  | 'cache_hit'
  | 'fetched'
  | 'invalid_keychain_request'
  | 'invalid_keychain_response'
  | 'key_rejected'
  | 'key_service_not_authorized'
  | 'key_service_rate_limited'
  | 'key_service_unavailable'
  | 'keychain_use_not_authorized'
  | 'not_required';

export interface KeychainResolutionSummary {
  readonly cacheHit: boolean;
  readonly failureCode: KeychainFailureCode | null;
  readonly hasKeychains: boolean;
  readonly providerCalled: boolean;
  readonly request: KeychainRequestMetadata | null;
  readonly response: KeychainPayloadMetadata | null;
  readonly schemaVersion: 1;
  readonly status: KeychainResolutionStatus;
}

export interface PrivateKeychainRequestSummary {
  readonly department: number;
  readonly featurePoints: number;
  readonly groups: number;
  readonly requestVersion: number;
  readonly schemaVersion: 1;
  readonly serializedBytes: number;
  readonly sourceHashVerified: true;
  readonly status: 'keychain_request_ready';
}

export class PrivateKeychainRequest {
  readonly summary: PrivateKeychainRequestSummary;
  #request: KeychainRequest | null;

  constructor(
    summary: PrivateKeychainRequestSummary,
    request: KeychainRequest,
  ) {
    this.summary = Object.freeze({ ...summary });
    this.#request = structuredClone(request);
  }

  consume(): KeychainRequest {
    if (!this.#request) {
      throw new Error('The private keychain request is unavailable.');
    }
    const request = this.#request;
    this.#request = null;
    return request;
  }

  destroy(): void {
    this.#request = null;
  }

  toJSON(): PrivateKeychainRequestSummary {
    return this.summary;
  }
}

export class PrivateKeychainResolution {
  readonly summary: KeychainResolutionSummary;
  #keychains: KeychainResponse | null;

  constructor(
    summary: KeychainResolutionSummary,
    keychains: KeychainResponse | null,
  ) {
    this.summary = Object.freeze({ ...summary });
    this.#keychains = keychains ? structuredClone(keychains) : null;
  }

  consumeForParser(): Buffer | null {
    if (!this.#keychains) return null;
    const keychains = this.#keychains;
    this.#keychains = null;
    return Buffer.from(JSON.stringify({ keychains }));
  }

  destroy(): void {
    this.#keychains = null;
  }

  toJSON(): KeychainResolutionSummary {
    return this.summary;
  }
}

function resolution(
  status: KeychainResolutionStatus,
  options: Partial<
    Omit<KeychainResolutionSummary, 'schemaVersion' | 'status'>
  > = {},
  keychains: KeychainResponse | null = null,
): PrivateKeychainResolution {
  return new PrivateKeychainResolution(
    {
      cacheHit: options.cacheHit ?? false,
      failureCode: options.failureCode ?? null,
      hasKeychains: keychains !== null,
      providerCalled: options.providerCalled ?? false,
      request: options.request ?? null,
      response: options.response ?? null,
      schemaVersion: 1,
      status,
    },
    keychains,
  );
}

function validIdentity(value: string): boolean {
  return value.length > 0 && value.length <= 200;
}

export class KeychainBroker {
  readonly #provider: KeychainProvider;
  readonly #store: KeychainStore;

  constructor(
    input: Readonly<{ provider: KeychainProvider; store: KeychainStore }>,
  ) {
    this.#provider = input.provider;
    this.#store = input.store;
  }

  async resolve(
    context: KeychainContext,
    requestFactory: () => Promise<unknown>,
  ): Promise<PrivateKeychainResolution> {
    if (
      !validIdentity(context.organizationId) ||
      !validIdentity(context.rawSourceId) ||
      !validIdentity(context.parserId) ||
      !Number.isSafeInteger(context.logVersion) ||
      context.logVersion < 0 ||
      context.logVersion > 255
    ) {
      throw new TypeError('Invalid keychain broker context.');
    }
    if (context.logVersion < 13) return resolution('not_required');

    const authorization = await this.#store.authorization(context);
    if (!authorization?.keychainUseAuthorized) {
      return resolution('keychain_use_not_authorized', {
        failureCode: 'keychain_use_not_authorized',
      });
    }

    const cached = await this.#store.get(context);
    if (cached) {
      const validated = validateKeychainResponse(cached);
      if (validated.valid) {
        return resolution(
          'cache_hit',
          { cacheHit: true, response: validated.metadata },
          cached,
        );
      }
      await this.#store.deleteSource(
        context.organizationId,
        context.rawSourceId,
      );
      return resolution('invalid_keychain_response', {
        failureCode: 'invalid_keychain_response',
      });
    }

    if (!authorization.externalServiceProcessingAuthorized) {
      return resolution('key_service_not_authorized', {
        failureCode: 'key_service_not_authorized',
      });
    }

    const candidate = await requestFactory();
    const requestValidation = validateKeychainRequest(candidate);
    if (!requestValidation.valid) {
      return resolution('invalid_keychain_request', {
        failureCode: 'invalid_keychain_request',
      });
    }

    const request = candidate as KeychainRequest;
    let keychains: KeychainResponse;
    try {
      keychains = await this.#provider.fetchKeychains({
        request,
        requestMetadata: requestValidation.metadata,
      });
    } catch (error) {
      const code =
        error instanceof KeychainProviderError
          ? error.code
          : 'key_service_unavailable';
      return resolution(code, {
        failureCode: code,
        providerCalled: true,
        request: requestValidation.metadata,
      });
    }

    const responseValidation = validateKeychainResponse(keychains);
    if (!responseValidation.valid) {
      return resolution('invalid_keychain_response', {
        failureCode: 'invalid_keychain_response',
        providerCalled: true,
        request: requestValidation.metadata,
      });
    }
    await this.#store.put(context, keychains, {
      noticeVersion: authorization.noticeVersion,
      providerId: this.#provider.id,
      termsVersion: authorization.termsVersion,
    });
    return resolution(
      'fetched',
      {
        providerCalled: true,
        request: requestValidation.metadata,
        response: responseValidation.metadata,
      },
      keychains,
    );
  }

  deleteOrganization(organizationId: string): Promise<number> {
    return this.#store.deleteOrganization(organizationId);
  }

  revokeSource(organizationId: string, rawSourceId: string): Promise<number> {
    return this.#store.deleteSource(organizationId, rawSourceId);
  }
}
