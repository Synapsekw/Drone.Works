import type { operations } from './generated/openapi.js';

type HealthOperation = operations['getApiHealth'];
type CreateOrganizationOperation = operations['createOrganization'];
type SelectOrganizationOperation = operations['selectOrganization'];
type CreateInvitationOperation = operations['createInvitation'];
type AcceptInvitationOperation = operations['acceptInvitation'];
type DeclareRawUploadOperation = operations['declareRawUpload'];
type PutRawUploadContentOperation = operations['putRawUploadContent'];
type CompleteRawUploadOperation = operations['completeRawUpload'];
type GetImportStatusOperation = operations['getImportStatus'];
type FlightSummaryOperation = operations['getFlightSummary'];
type FlightTrackOperation = operations['getFlightTrack'];

export type ApiHealth =
  HealthOperation['responses'][200]['content']['application/json'];
export type ApiProblem =
  HealthOperation['responses']['4XX']['content']['application/problem+json'];
export type ApiOrganizationSelection =
  SelectOrganizationOperation['responses'][200]['content']['application/json'];
export type ApiCreateOrganizationBody =
  CreateOrganizationOperation['requestBody']['content']['application/json'];
export type ApiCreateInvitationBody =
  CreateInvitationOperation['requestBody']['content']['application/json'];
export type ApiInvitation =
  CreateInvitationOperation['responses'][201]['content']['application/json'];
export type ApiMembership =
  AcceptInvitationOperation['responses'][200]['content']['application/json'];
export type ApiRawUploadDeclaration =
  DeclareRawUploadOperation['responses'][201]['content']['application/json'];
export type ApiRawUploadContent =
  PutRawUploadContentOperation['responses'][200]['content']['application/json'];
export type ApiRawUpload =
  CompleteRawUploadOperation['responses'][200]['content']['application/json'];
export type ApiImportStatus =
  GetImportStatusOperation['responses'][200]['content']['application/json'];
export type ApiFlightSummary =
  FlightSummaryOperation['responses'][200]['content']['application/json'];
export type ApiFlightTrack =
  FlightTrackOperation['responses'][200]['content']['application/json'];

export interface ApiRequestOptions {
  readonly baseUrl: string;
  readonly identityHeaders?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export class ApiClientError extends Error {
  readonly problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.detail);
    this.name = 'ApiClientError';
    this.problem = problem;
  }
}

function apiUrl(options: ApiRequestOptions, path: string): URL {
  return new URL(path, options.baseUrl);
}

async function responseBody<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let problem: ApiProblem;
    try {
      problem = (await response.json()) as ApiProblem;
    } catch {
      problem = {
        correlation_id:
          response.headers.get('x-correlation-id') ?? 'unavailable',
        detail: 'The request could not be completed.',
        instance: new URL(response.url).pathname,
        status: response.status,
        title: 'Request Failed',
        type: 'about:blank',
      };
    }
    throw new ApiClientError(problem);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function headers(
  options: ApiRequestOptions,
  values: Readonly<Record<string, string>> = {},
): Headers {
  return new Headers({
    accept: 'application/json',
    ...options.identityHeaders,
    ...values,
  });
}

async function request<T>(
  options: ApiRequestOptions,
  path: string,
  init: RequestInit,
): Promise<T> {
  return responseBody<T>(
    await fetch(apiUrl(options, path), {
      cache: 'no-store',
      credentials: 'same-origin',
      ...init,
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );
}

export async function getApiHealth(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ApiHealth> {
  const response = await fetch(new URL('/api/v1/health', baseUrl), {
    headers: { accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}.`);
  }

  return (await response.json()) as ApiHealth;
}

export async function createOrganization(
  options: ApiRequestOptions,
  body: ApiCreateOrganizationBody,
): Promise<ApiOrganizationSelection> {
  return request<ApiOrganizationSelection>(options, '/api/v1/organizations', {
    body: JSON.stringify(body),
    headers: headers(options, { 'content-type': 'application/json' }),
    method: 'POST',
  });
}

export async function selectOrganization(
  options: ApiRequestOptions,
  organizationId: string,
): Promise<ApiOrganizationSelection> {
  return request<ApiOrganizationSelection>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/selection`,
    { headers: headers(options), method: 'PUT' },
  );
}

export async function createInvitation(
  options: ApiRequestOptions,
  organizationId: string,
  body: ApiCreateInvitationBody,
): Promise<ApiInvitation> {
  return request<ApiInvitation>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/invitations`,
    {
      body: JSON.stringify(body),
      headers: headers(options, { 'content-type': 'application/json' }),
      method: 'POST',
    },
  );
}

export async function acceptInvitation(
  options: ApiRequestOptions,
  organizationId: string,
  token: string,
): Promise<ApiMembership> {
  return request<ApiMembership>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/invitations/accept`,
    {
      body: JSON.stringify({ token }),
      headers: headers(options, { 'content-type': 'application/json' }),
      method: 'POST',
    },
  );
}

export async function revokeInvitation(
  options: ApiRequestOptions,
  organizationId: string,
  invitationId: string,
): Promise<void> {
  await request<undefined>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
    { headers: headers(options), method: 'DELETE' },
  );
}

export async function declareRawUpload(
  options: ApiRequestOptions,
  organizationId: string,
  input: Readonly<{
    byte_size: number;
    client_file_id: string;
    content_sha256: string;
    original_filename: string;
  }>,
  idempotencyKey: string,
): Promise<ApiRawUploadDeclaration> {
  return request<ApiRawUploadDeclaration>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/uploads`,
    {
      body: JSON.stringify({
        ...input,
        media_type: 'application/octet-stream',
      }),
      headers: headers(options, {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      }),
      method: 'POST',
    },
  );
}

export async function putRawUploadContent(
  options: ApiRequestOptions,
  organizationId: string,
  uploadId: string,
  content: ArrayBuffer,
): Promise<ApiRawUploadContent> {
  return request<ApiRawUploadContent>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/uploads/${encodeURIComponent(uploadId)}/content`,
    {
      body: content,
      headers: headers(options, { 'content-type': 'application/octet-stream' }),
      method: 'PUT',
    },
  );
}

export async function completeRawUpload(
  options: ApiRequestOptions,
  organizationId: string,
  uploadId: string,
  objectVersionId: string,
  idempotencyKey: string,
  approval: Readonly<{ approveDjiEncryptedProcessing?: boolean }> = {},
): Promise<ApiRawUpload> {
  return request<ApiRawUpload>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/uploads/${encodeURIComponent(uploadId)}/completion`,
    {
      body: JSON.stringify({
        object_version_id: objectVersionId,
        ...(approval.approveDjiEncryptedProcessing
          ? { dji_encrypted_processing: 'approved' as const }
          : {}),
      }),
      headers: headers(options, {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      }),
      method: 'POST',
    },
  );
}

export async function getImportStatus(
  options: ApiRequestOptions,
  organizationId: string,
  importId: string,
): Promise<ApiImportStatus> {
  return request<ApiImportStatus>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/imports/${encodeURIComponent(importId)}`,
    { headers: headers(options), method: 'GET' },
  );
}

export async function getFlightSummary(
  options: ApiRequestOptions,
  organizationId: string,
  flightId: string,
): Promise<ApiFlightSummary> {
  return request<ApiFlightSummary>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/flights/${encodeURIComponent(flightId)}`,
    { headers: headers(options), method: 'GET' },
  );
}

export async function getFlightTrack(
  options: ApiRequestOptions,
  organizationId: string,
  flightId: string,
): Promise<ApiFlightTrack> {
  return request<ApiFlightTrack>(
    options,
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/flights/${encodeURIComponent(flightId)}/track?mode=default`,
    { headers: headers(options), method: 'GET' },
  );
}
