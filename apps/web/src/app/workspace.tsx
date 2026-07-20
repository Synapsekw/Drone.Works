'use client';

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ApiClientError,
  type ApiFlightList,
  type ApiFlightSummary,
  type ApiFlightTrack,
  type ApiImportStatus,
  type ApiOrganizationSelection,
  completeRawUpload,
  acceptInvitation,
  createInvitation,
  createOrganization,
  declareRawUpload,
  getFlightSummary,
  getFlightTrack,
  getImportStatus,
  listFlights,
  putRawUploadContent,
  selectOrganization,
} from '@drone-works/contracts/client';

import { FlightMap } from './flight-map';

type ActivityState = 'empty' | 'loading' | 'success' | 'error';

export interface WorkspaceIdentity {
  readonly label: string;
  readonly token: string;
}

interface VerifiedIdentity {
  readonly displayName: string;
  readonly email: string;
}

interface InvitationEntry {
  readonly organizationId: string;
  readonly token: string;
}

const terminalImportStates = new Set<ApiImportStatus['state']>([
  'awaiting_review',
  'cancelled',
  'completed',
  'failed',
  'skipped_duplicate',
]);

const importLabels: Record<ApiImportStatus['state'], string> = {
  uploaded: 'Uploaded',
  queued: 'Queued for isolated processing',
  detecting: 'Detecting the source format',
  parsing: 'Parsing in the isolated worker',
  normalizing: 'Building the canonical flight',
  awaiting_review: 'Flight created — review is required',
  completed: 'Flight created',
  failed: 'Processing failed',
  cancelled: 'Processing cancelled',
  skipped_duplicate: 'Exact duplicate — retained flight reused',
};

function apiOptions(token: string, signal?: AbortSignal) {
  return {
    baseUrl: window.location.origin,
    ...(token
      ? {
          identityHeaders: {
            'x-drone-works-local-persona-token': token,
          },
        }
      : {}),
    ...(signal ? { signal } : {}),
  };
}

function publicError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.problem.status === 401) {
      return 'The current identity expired. Sign in again.';
    }
    if (error.problem.status === 403 || error.problem.status === 404) {
      return 'This resource is not available to the current organization membership.';
    }
    return `${error.problem.detail} Correlation ID: ${error.problem.correlation_id}.`;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'The request was cancelled.';
  }
  return 'The request could not be completed. Try again.';
}

function failureMessage(reason: ApiImportStatus['failure_reason']): string {
  switch (reason) {
    case 'unsupported':
      return 'This file is not one of the explicitly supported DJI formats.';
    case 'corrupt':
      return 'The source is corrupt or malformed and could not be decoded safely.';
    case 'truncated':
      return 'The source is truncated. Its incomplete record was not treated as a complete flight.';
    case 'key_unavailable':
      return 'The supported encrypted source needs a key that is currently unavailable.';
    default:
      return 'Processing failed in isolation. The source remains retained for a safe retry.';
  }
}

function numberFact(
  summary: ApiFlightSummary,
  key: 'distance_m' | 'duration_ms' | 'max_height_m',
  unit: string,
): string {
  const fact = summary.facts[key];
  if (fact.value === null) return 'Unavailable';
  const value = key === 'duration_ms' ? fact.value / 1000 : fact.value;
  return `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)} ${unit} · ${fact.origin.replace('_', ' ')}`;
}

function compactDuration(milliseconds: number): string {
  const hours = milliseconds / 3_600_000;
  return hours < 0.1
    ? `${Math.round(milliseconds / 60_000)} min`
    : `${hours.toFixed(1)} h`;
}

function factNumber(
  summary: ApiFlightSummary,
  key: 'distance_m' | 'duration_ms',
): number | null {
  return summary.facts[key].value;
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function Workspace({
  environmentBadge,
  identity,
  identityPanel,
  initialOrganizationId,
  invitation,
  verifiedIdentity,
}: {
  readonly environmentBadge: ReactNode;
  readonly identity: WorkspaceIdentity | null;
  readonly identityPanel: ReactNode;
  readonly initialOrganizationId?: string;
  readonly invitation?: InvitationEntry;
  readonly verifiedIdentity?: VerifiedIdentity;
}) {
  const [organizationId, setOrganizationId] = useState<string>(
    invitation?.organizationId ?? initialOrganizationId ?? '',
  );
  const [organization, setOrganization] =
    useState<ApiOrganizationSelection | null>(null);
  const [organizationState, setOrganizationState] =
    useState<ActivityState>('empty');
  const [flightLibrary, setFlightLibrary] = useState<ApiFlightList | null>(
    null,
  );
  const [libraryState, setLibraryState] = useState<ActivityState>('empty');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<
    '' | 'active' | 'awaiting_review'
  >('');
  const [invitationMessage, setInvitationMessage] = useState<string | null>(
    null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [approveDjiProcessing, setApproveDjiProcessing] = useState(false);
  const [importStatus, setImportStatus] = useState<ApiImportStatus | null>(
    null,
  );
  const [uploadState, setUploadState] = useState<ActivityState>('empty');
  const [uploadMessage, setUploadMessage] = useState(
    'Choose one supported source file to begin.',
  );
  const [flightId, setFlightId] = useState('');
  const [flight, setFlight] = useState<ApiFlightSummary | null>(null);
  const [track, setTrack] = useState<ApiFlightTrack | null>(null);
  const [flightState, setFlightState] = useState<ActivityState>('empty');
  const [error, setError] = useState<string | null>(null);
  const pollController = useRef<AbortController | null>(null);
  const activeIdentity = identity;

  const clearOrganizationState = () => {
    pollController.current?.abort();
    pollController.current = null;
    setOrganization(null);
    setFlightLibrary(null);
    setLibraryState('empty');
    setLibrarySearch('');
    setLibraryFilter('');
    setInvitationMessage(null);
    setFile(null);
    setApproveDjiProcessing(false);
    setImportStatus(null);
    setUploadState('empty');
    setUploadMessage('Choose one supported source file to begin.');
    setFlightId('');
    setFlight(null);
    setTrack(null);
    setFlightState('empty');
    setError(null);
  };

  useEffect(
    () => () => {
      pollController.current?.abort();
    },
    [],
  );

  const loadFlightLibrary = async (
    selectedOrganization: ApiOrganizationSelection,
    token: string,
    input: Readonly<{
      append?: boolean;
      cursor?: string;
      search?: string;
      state?: '' | 'active' | 'awaiting_review';
    }> = {},
  ) => {
    setLibraryState('loading');
    setError(null);
    try {
      const result = await listFlights(
        apiOptions(token),
        selectedOrganization.organization_id,
        {
          limit: 25,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.search?.trim() ? { search: input.search.trim() } : {}),
          ...(input.state ? { state: input.state } : {}),
        },
      );
      setFlightLibrary((current) =>
        input.append && current
          ? { ...result, items: [...current.items, ...result.items] }
          : result,
      );
      setLibraryState('success');
    } catch (libraryError) {
      setLibraryState('error');
      setError(publicError(libraryError));
    }
  };

  const enterOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeIdentity) return;
    clearOrganizationState();
    setOrganizationState('loading');
    try {
      const selected = await selectOrganization(
        apiOptions(activeIdentity.token),
        organizationId.trim(),
      );
      setOrganization(selected);
      setOrganizationState('success');
      await loadFlightLibrary(selected, activeIdentity.token);
    } catch (organizationError) {
      setOrganizationState('error');
      setError(publicError(organizationError));
    }
  };

  const createNewOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeIdentity) return;
    const data = new FormData(event.currentTarget);
    clearOrganizationState();
    setOrganizationState('loading');
    try {
      const created = await createOrganization(
        apiOptions(activeIdentity.token),
        {
          default_timezone: String(data.get('timezone') ?? 'Asia/Dubai'),
          name: String(data.get('name') ?? '').trim(),
          unit_system: 'metric',
        },
      );
      setOrganizationId(created.organization_id);
      setOrganization(created);
      setOrganizationState('success');
      await loadFlightLibrary(created, activeIdentity.token);
    } catch (organizationError) {
      setOrganizationState('error');
      setError(publicError(organizationError));
    }
  };

  const acceptCurrentInvitation = async () => {
    if (!activeIdentity || !invitation) return;
    clearOrganizationState();
    setOrganizationState('loading');
    try {
      await acceptInvitation(
        apiOptions(activeIdentity.token),
        invitation.organizationId,
        invitation.token,
      );
      const selected = await selectOrganization(
        apiOptions(activeIdentity.token),
        invitation.organizationId,
      );
      setOrganizationId(invitation.organizationId);
      setOrganization(selected);
      setOrganizationState('success');
      await loadFlightLibrary(selected, activeIdentity.token);
    } catch (invitationError) {
      setOrganizationState('error');
      setError(publicError(invitationError));
    }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeIdentity || !organization) return;
    const data = new FormData(event.currentTarget);
    setInvitationMessage('Sending the single-use invitation…');
    setError(null);
    try {
      const created = await createInvitation(
        apiOptions(activeIdentity.token),
        organization.organization_id,
        {
          email: String(data.get('email') ?? '').trim(),
          role: String(data.get('role') ?? 'viewer') as
            'admin' | 'pilot' | 'viewer',
        },
      );
      setInvitationMessage(
        `Invitation ready until ${new Date(created.expires_at).toLocaleString()}.`,
      );
      event.currentTarget.reset();
    } catch (invitationError) {
      setInvitationMessage(null);
      setError(publicError(invitationError));
    }
  };

  const openFlight = async (
    requestedFlightId: string,
    token = activeIdentity?.token,
    selectedOrganization = organization,
  ) => {
    if (token === undefined || !selectedOrganization || !requestedFlightId)
      return;
    setFlight(null);
    setTrack(null);
    setFlightState('loading');
    setError(null);
    try {
      const summary = await getFlightSummary(
        apiOptions(token),
        selectedOrganization.organization_id,
        requestedFlightId,
      );
      setFlight(summary);
      if (
        summary.telemetry &&
        summary.capabilities.includes('telemetry.position')
      ) {
        setTrack(
          await getFlightTrack(
            apiOptions(token),
            selectedOrganization.organization_id,
            requestedFlightId,
          ),
        );
      }
      setFlightState('success');
    } catch (flightError) {
      setFlightState('error');
      setError(publicError(flightError));
    }
  };

  const pollImport = async (importId: string, controller: AbortController) => {
    if (!activeIdentity || !organization) return;
    for (let attempt = 0; attempt < 360; attempt += 1) {
      const status = await getImportStatus(
        apiOptions(activeIdentity.token, controller.signal),
        organization.organization_id,
        importId,
      );
      setImportStatus(status);
      setUploadMessage(importLabels[status.state]);
      if (terminalImportStates.has(status.state)) {
        if (status.state === 'failed') {
          setUploadState('error');
          setError(failureMessage(status.failure_reason));
          return;
        }
        setUploadState('success');
        if (status.result_flight_id) {
          setFlightId(status.result_flight_id);
          await openFlight(
            status.result_flight_id,
            activeIdentity.token,
            organization,
          );
          await loadFlightLibrary(organization, activeIdentity.token, {
            search: librarySearch,
            state: libraryFilter,
          });
        }
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, 500);
        controller.signal.addEventListener(
          'abort',
          () => {
            window.clearTimeout(timer);
            reject(new DOMException('Polling aborted.', 'AbortError'));
          },
          { once: true },
        );
      });
    }
    throw new Error('Processing did not reach a terminal state in time.');
  };

  const uploadFile = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeIdentity || !organization || !file) return;
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    setUploadState('loading');
    setUploadMessage('Hashing the file locally');
    setImportStatus(null);
    setFlight(null);
    setTrack(null);
    setFlightState('empty');
    setError(null);
    try {
      const content = await file.arrayBuffer();
      const digest = await sha256(content);
      const clientFileId = crypto.randomUUID();
      setUploadMessage('Declaring the immutable source');
      const declaration = await declareRawUpload(
        apiOptions(activeIdentity.token, controller.signal),
        organization.organization_id,
        {
          byte_size: file.size,
          client_file_id: clientFileId,
          content_sha256: digest,
          original_filename: file.name,
        },
        `web-declare-${clientFileId}`,
      );
      setUploadMessage('Writing the exact source bytes');
      const stored = await putRawUploadContent(
        apiOptions(activeIdentity.token, controller.signal),
        organization.organization_id,
        declaration.upload_id,
        content,
      );
      setUploadMessage('Completing the immutable upload');
      await completeRawUpload(
        apiOptions(activeIdentity.token, controller.signal),
        organization.organization_id,
        declaration.upload_id,
        stored.object_version_id,
        `web-complete-${clientFileId}`,
        { approveDjiEncryptedProcessing: approveDjiProcessing },
      );
      setUploadMessage('Queued for isolated processing');
      await pollImport(declaration.upload_id, controller);
    } catch (uploadError) {
      if (!(
        uploadError instanceof DOMException && uploadError.name === 'AbortError'
      )) {
        setUploadState('error');
        setError(publicError(uploadError));
      }
    } finally {
      if (pollController.current === controller) pollController.current = null;
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0] ?? null;
    setFile(selected);
    setUploadState('empty');
    setUploadMessage(
      selected
        ? `${selected.name} · ${new Intl.NumberFormat('en').format(selected.size)} bytes`
        : 'Choose one supported source file to begin.',
    );
    setError(null);
  };

  return (
    <main className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Drone.Works</p>
          <h1>From source log to truthful flight</h1>
          <p className="lede">
            One protected path for organization entry, immutable upload,
            processing status, and a capability-aware 2D track.
          </p>
        </div>
        <div className="environment-badge" role="note">
          {environmentBadge}
        </div>
      </header>

      <section className="step-card" aria-labelledby="identity-heading">
        <div className="step-number">01</div>
        <div className="step-content">{identityPanel}</div>
      </section>

      <section className="step-card" aria-labelledby="organization-heading">
        <div className="step-number">02</div>
        <div className="step-content">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Organization boundary</p>
              <h2 id="organization-heading">Enter or create an organization</h2>
            </div>
            <StatePill state={organizationState} />
          </div>
          <form
            className="form-grid"
            onSubmit={(event) => void enterOrganization(event)}
          >
            <label>
              Organization ID
              <input
                autoComplete="off"
                disabled={!activeIdentity || organizationState === 'loading'}
                onChange={(event) =>
                  setOrganizationId(event.currentTarget.value)
                }
                required
                value={organizationId}
              />
            </label>
            <button
              disabled={!activeIdentity || organizationState === 'loading'}
              type="submit"
            >
              {organizationState === 'loading'
                ? 'Checking membership…'
                : 'Enter organization'}
            </button>
          </form>
          <details>
            <summary>Create a fresh organization</summary>
            <form
              className="form-grid compact-form"
              onSubmit={(event) => void createNewOrganization(event)}
            >
              <label>
                Organization name
                <input
                  name="name"
                  required
                  maxLength={200}
                  defaultValue="Generated field team"
                />
              </label>
              <label>
                Display timezone
                <input name="timezone" required defaultValue="Asia/Dubai" />
              </label>
              <button disabled={!activeIdentity} type="submit">
                Create and enter
              </button>
            </form>
          </details>
          {verifiedIdentity && invitation ? (
            <div className="invitation-panel">
              <strong>A single-use organization invitation is ready.</strong>
              <button
                disabled={organizationState === 'loading'}
                onClick={() => void acceptCurrentInvitation()}
                type="button"
              >
                Accept invitation
              </button>
            </div>
          ) : null}
          {verifiedIdentity &&
          organization &&
          (organization.role === 'owner' || organization.role === 'admin') ? (
            <details>
              <summary>Invite a verified member</summary>
              <form
                className="form-grid compact-form"
                onSubmit={(event) => void inviteMember(event)}
              >
                <label>
                  Verified email
                  <input name="email" required type="email" />
                </label>
                <label>
                  Role
                  <select defaultValue="viewer" name="role">
                    <option value="admin">Admin</option>
                    <option value="pilot">Pilot</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
                <button type="submit">Send invitation</button>
              </form>
              {invitationMessage ? (
                <p className="state-line" role="status">
                  {invitationMessage}
                </p>
              ) : null}
            </details>
          ) : null}
          <p
            className="state-line"
            aria-live="polite"
            data-testid="organization-state"
          >
            {organization
              ? `${organization.name} · ${organization.role} · ${organization.default_timezone}`
              : 'Organization-bound data is empty.'}
          </p>
        </div>
      </section>

      <section className="operations-card" aria-labelledby="library-heading">
        <div className="operations-heading">
          <div>
            <p className="section-kicker">Operational logbook</p>
            <h2 id="library-heading">Flights at a glance</h2>
            <p>
              Current retained revisions for this organization. Demo records are
              synthetic and contain no customer coordinates.
            </p>
          </div>
          <StatePill state={libraryState} />
        </div>
        <FlightTotals list={flightLibrary} />
        <form
          className="library-filters"
          onSubmit={(event) => {
            event.preventDefault();
            if (activeIdentity && organization) {
              void loadFlightLibrary(organization, activeIdentity.token, {
                search: librarySearch,
                state: libraryFilter,
              });
            }
          }}
        >
          <label>
            Search flights
            <input
              disabled={!organization || libraryState === 'loading'}
              onChange={(event) => setLibrarySearch(event.currentTarget.value)}
              placeholder="Aircraft, pilot, model, or flight ID"
              value={librarySearch}
            />
          </label>
          <label>
            Review state
            <select
              disabled={!organization || libraryState === 'loading'}
              onChange={(event) =>
                setLibraryFilter(
                  event.currentTarget.value as
                    '' | 'active' | 'awaiting_review',
                )
              }
              value={libraryFilter}
            >
              <option value="">All current flights</option>
              <option value="active">Active</option>
              <option value="awaiting_review">Needs review</option>
            </select>
          </label>
          <button
            disabled={!organization || libraryState === 'loading'}
            type="submit"
          >
            Apply filters
          </button>
        </form>
        {libraryState === 'loading' && !flightLibrary ? (
          <div className="library-empty" role="status">
            Loading authorized flights…
          </div>
        ) : flightLibrary?.items.length ? (
          <div className="flight-table-wrap">
            <table className="flight-table">
              <thead>
                <tr>
                  <th scope="col">Takeoff</th>
                  <th scope="col">Aircraft</th>
                  <th scope="col">Pilot</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Distance</th>
                  <th scope="col">State</th>
                  <th scope="col">
                    <span className="visually-hidden">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {flightLibrary.items.map((item) => {
                  const duration = factNumber(item, 'duration_ms');
                  const distance = factNumber(item, 'distance_m');
                  return (
                    <tr key={item.flight_id}>
                      <td>
                        {item.facts.takeoff_time_utc.value
                          ? new Date(
                              item.facts.takeoff_time_utc.value,
                            ).toLocaleString()
                          : 'Unavailable'}
                      </td>
                      <td>
                        <strong>
                          {item.aircraft_display_name ?? 'Unassigned'}
                        </strong>
                        <span>
                          {item.facts.aircraft_model.value ??
                            'Model unavailable'}
                        </span>
                      </td>
                      <td>{item.pilot_display_name ?? 'Unassigned'}</td>
                      <td>
                        {duration === null ? '—' : compactDuration(duration)}
                      </td>
                      <td>
                        {distance === null
                          ? '—'
                          : `${new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(distance)} m`}
                      </td>
                      <td>
                        <span className={`flight-state ${item.state}`}>
                          {item.state === 'active' ? 'Active' : 'Needs review'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="table-button"
                          onClick={() => {
                            setFlightId(item.flight_id);
                            void openFlight(item.flight_id);
                          }}
                          type="button"
                        >
                          Open flight
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="library-empty">
            {organization
              ? 'No current flights match these filters.'
              : 'Enter an organization to load its flight logbook.'}
          </div>
        )}
        {flightLibrary?.next_cursor && organization && activeIdentity ? (
          <button
            className="secondary-button load-more"
            disabled={libraryState === 'loading'}
            onClick={() =>
              void loadFlightLibrary(organization, activeIdentity.token, {
                append: true,
                cursor: flightLibrary.next_cursor ?? undefined,
                search: librarySearch,
                state: libraryFilter,
              })
            }
            type="button"
          >
            Load more flights
          </button>
        ) : null}
      </section>

      <section className="step-card" aria-labelledby="upload-heading">
        <div className="step-number">03</div>
        <div className="step-content">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Immutable source</p>
              <h2 id="upload-heading">Upload one supported file</h2>
            </div>
            <StatePill state={uploadState} />
          </div>
          <form
            className="upload-form"
            onSubmit={(event) => void uploadFile(event)}
          >
            <label className="file-drop">
              <span>Select a DJI source log</span>
              <input
                accept=".txt,.bin,application/octet-stream,text/plain"
                disabled={!organization || uploadState === 'loading'}
                onChange={onFile}
                type="file"
              />
            </label>
            <label className="consent-control">
              <input
                checked={approveDjiProcessing}
                disabled={!organization || uploadState === 'loading'}
                onChange={(event) =>
                  setApproveDjiProcessing(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>
                <strong>Approve encrypted DJI processing if required</strong>
                <small>
                  Drone.Works may send a bounded encrypted key request—not the
                  flight log—to DJI, then stores the returned keychain encrypted
                  for this organization and source. Leaving this unchecked sends
                  nothing to DJI.
                </small>
              </span>
            </label>
            <button
              disabled={!file || !organization || uploadState === 'loading'}
              type="submit"
            >
              {uploadState === 'loading' ? 'Processing…' : 'Upload and process'}
            </button>
          </form>
          <div className="progress-panel" role="status" aria-live="polite">
            <span
              className={
                uploadState === 'loading'
                  ? 'activity-dot active'
                  : 'activity-dot'
              }
            />
            <div>
              <strong>{uploadMessage}</strong>
              <span>
                {importStatus
                  ? `Import ${importStatus.import_id} · updated ${new Date(importStatus.updated_at).toLocaleTimeString()}`
                  : 'No processing attempt yet.'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        className="step-card flight-card"
        aria-labelledby="flight-heading"
      >
        <div className="step-number">04</div>
        <div className="step-content">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Current retained revision</p>
              <h2 id="flight-heading">Open the flight summary</h2>
            </div>
            <StatePill state={flightState} />
          </div>
          <form
            className="form-grid flight-form"
            onSubmit={(event) => {
              event.preventDefault();
              void openFlight(flightId.trim());
            }}
          >
            <label>
              Flight ID
              <input
                disabled={!organization || flightState === 'loading'}
                onChange={(event) => setFlightId(event.currentTarget.value)}
                placeholder="Filled automatically when processing completes"
                value={flightId}
              />
            </label>
            <button
              disabled={!organization || !flightId || flightState === 'loading'}
              type="submit"
            >
              Open flight
            </button>
          </form>

          {flightState === 'loading' ? (
            <div className="empty-panel" role="status">
              Loading the authorized current revision…
            </div>
          ) : flight ? (
            <FlightDetail summary={flight} track={track} />
          ) : (
            <div className="empty-panel">
              No flight is open. A completed import opens its result
              automatically.
            </div>
          )}
        </div>
      </section>

      {error ? (
        <div className="error-banner" role="alert">
          <strong>Action needed</strong>
          <span>{error}</span>
        </div>
      ) : null}
    </main>
  );
}

export function StatePill({ state }: { readonly state: ActivityState }) {
  const labels: Record<ActivityState, string> = {
    empty: 'Waiting',
    loading: 'Working',
    success: 'Ready',
    error: 'Needs attention',
  };
  return <span className={`state-pill ${state}`}>{labels[state]}</span>;
}

function FlightTotals({ list }: { readonly list: ApiFlightList | null }) {
  const totals = list?.totals;
  const metrics = [
    ['Active flights', totals ? String(totals.active_flights) : '—'],
    ['Flight time', totals ? compactDuration(totals.total_duration_ms) : '—'],
    [
      'Distance',
      totals
        ? `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(totals.total_distance_m / 1000)} km`
        : '—',
    ],
    ['Needs review', totals ? String(totals.awaiting_review) : '—'],
  ] as const;
  return (
    <dl className="metric-grid" data-testid="flight-totals">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FlightDetail({
  summary,
  track,
}: {
  readonly summary: ApiFlightSummary;
  readonly track: ApiFlightTrack | null;
}) {
  return (
    <div className="flight-layout" data-testid="flight-detail">
      <div className="summary-panel">
        <div className="summary-title">
          <div>
            <span>Flight {summary.flight_id.slice(0, 8)}</span>
            <strong>
              {summary.facts.aircraft_name.value ??
                summary.facts.aircraft_model.value ??
                'Unnamed aircraft'}
            </strong>
          </div>
          <span className="revision-chip">
            Revision {summary.revision_number}
          </span>
        </div>
        <dl className="facts-grid">
          <div>
            <dt>Takeoff</dt>
            <dd>{summary.facts.takeoff_time_utc.value ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{numberFact(summary, 'duration_ms', 's')}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{numberFact(summary, 'distance_m', 'm')}</dd>
          </div>
          <div>
            <dt>Max height</dt>
            <dd>{numberFact(summary, 'max_height_m', 'm')}</dd>
          </div>
          <div>
            <dt>Assignment</dt>
            <dd>{summary.assignment_status.replaceAll('_', ' ')}</dd>
          </div>
          <div>
            <dt>Samples</dt>
            <dd>{summary.telemetry?.sample_count ?? 'Unavailable'}</dd>
          </div>
        </dl>
        <div className="capability-list" aria-label="Available capabilities">
          {summary.capabilities.length ? (
            summary.capabilities.map((capability) => (
              <span key={capability}>
                {capability.replace('telemetry.', '')}
              </span>
            ))
          ) : (
            <span>no telemetry capabilities</span>
          )}
        </div>
      </div>
      <FlightMap summary={summary} track={track} />
    </div>
  );
}
