'use client';

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ApiClientError,
  type ApiFlightSummary,
  type ApiFlightTrack,
  type ApiImportStatus,
  type ApiOrganizationSelection,
  completeRawUpload,
  createOrganization,
  declareRawUpload,
  getFlightSummary,
  getFlightTrack,
  getImportStatus,
  putRawUploadContent,
  selectOrganization,
} from '@drone-works/contracts/client';

import { FlightMap } from './flight-map';

const generatedOrganizations = {
  alpha_owner: '00000000-0000-4000-8000-0000000000a1',
  beta_owner: '00000000-0000-4000-8000-0000000000b1',
} as const;

type PersonaName = keyof typeof generatedOrganizations;
type ActivityState = 'empty' | 'loading' | 'success' | 'error';

interface PersonaSelection {
  readonly persona: PersonaName;
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
    identityHeaders: {
      'x-drone-works-local-persona-token': token,
    },
    ...(signal ? { signal } : {}),
  };
}

function publicError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.problem.status === 401) {
      return 'The local development identity expired. Select the persona again.';
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

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function LocalWorkspace() {
  const [persona, setPersona] = useState<PersonaSelection | null>(null);
  const [personaState, setPersonaState] = useState<ActivityState>('empty');
  const [organizationId, setOrganizationId] = useState<string>(
    generatedOrganizations.alpha_owner,
  );
  const [organization, setOrganization] =
    useState<ApiOrganizationSelection | null>(null);
  const [organizationState, setOrganizationState] =
    useState<ActivityState>('empty');
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

  const clearOrganizationState = () => {
    pollController.current?.abort();
    pollController.current = null;
    setOrganization(null);
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

  const choosePersona = async (nextPersona: PersonaName) => {
    clearOrganizationState();
    setPersona(null);
    setPersonaState('loading');
    setOrganizationId(generatedOrganizations[nextPersona]);
    try {
      const response = await fetch('/_local/generated-personas/select', {
        body: JSON.stringify({ persona: nextPersona }),
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'POST',
      });
      if (!response.ok) throw new Error('Local identity control unavailable.');
      setPersona((await response.json()) as PersonaSelection);
      setPersonaState('success');
    } catch (identityError) {
      setPersonaState('error');
      setError(publicError(identityError));
    }
  };

  const enterOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (!persona) return;
    clearOrganizationState();
    setOrganizationState('loading');
    try {
      const selected = await selectOrganization(
        apiOptions(persona.token),
        organizationId.trim(),
      );
      setOrganization(selected);
      setOrganizationState('success');
    } catch (organizationError) {
      setOrganizationState('error');
      setError(publicError(organizationError));
    }
  };

  const createNewOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!persona) return;
    const data = new FormData(event.currentTarget);
    clearOrganizationState();
    setOrganizationState('loading');
    try {
      const created = await createOrganization(apiOptions(persona.token), {
        default_timezone: String(data.get('timezone') ?? 'Asia/Dubai'),
        name: String(data.get('name') ?? '').trim(),
        unit_system: 'metric',
      });
      setOrganizationId(created.organization_id);
      setOrganization(created);
      setOrganizationState('success');
    } catch (organizationError) {
      setOrganizationState('error');
      setError(publicError(organizationError));
    }
  };

  const openFlight = async (
    requestedFlightId: string,
    token = persona?.token,
    selectedOrganization = organization,
  ) => {
    if (!token || !selectedOrganization || !requestedFlightId) return;
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
    if (!persona || !organization) return;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const status = await getImportStatus(
        apiOptions(persona.token, controller.signal),
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
            persona.token,
            organization,
          );
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
    if (!persona || !organization || !file) return;
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
        apiOptions(persona.token, controller.signal),
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
        apiOptions(persona.token, controller.signal),
        organization.organization_id,
        declaration.upload_id,
        content,
      );
      setUploadMessage('Completing the immutable upload');
      await completeRawUpload(
        apiOptions(persona.token, controller.signal),
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
          <strong>Local development identity</strong>
          <span>Generated personas are not authentication.</span>
          <span>This control is excluded from hosted builds.</span>
        </div>
      </header>

      <section className="step-card" aria-labelledby="identity-heading">
        <div className="step-number">01</div>
        <div className="step-content">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Development access</p>
              <h2 id="identity-heading">Choose a generated persona</h2>
            </div>
            <StatePill state={personaState} />
          </div>
          <p className="supporting-copy">
            The API resolves only its server allowlist. Membership and forced
            PostgreSQL RLS still authorize every organization operation.
          </p>
          <div
            className="button-row"
            role="group"
            aria-label="Generated persona"
          >
            <button
              type="button"
              onClick={() => void choosePersona('alpha_owner')}
            >
              Generated Alpha owner
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void choosePersona('beta_owner')}
            >
              Generated Beta owner
            </button>
          </div>
          <p className="state-line" aria-live="polite">
            {persona
              ? `Active persona: ${persona.persona.replace('_', ' ')}`
              : 'No persona selected.'}
          </p>
        </div>
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
                disabled={!persona || organizationState === 'loading'}
                onChange={(event) =>
                  setOrganizationId(event.currentTarget.value)
                }
                required
                value={organizationId}
              />
            </label>
            <button
              disabled={!persona || organizationState === 'loading'}
              type="submit"
            >
              {organizationState === 'loading'
                ? 'Checking membership…'
                : 'Enter organization'}
            </button>
          </form>
          <details>
            <summary>Create a fresh local organization</summary>
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
              <button disabled={!persona} type="submit">
                Create and enter
              </button>
            </form>
          </details>
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

function StatePill({ state }: { readonly state: ActivityState }) {
  const labels: Record<ActivityState, string> = {
    empty: 'Waiting',
    loading: 'Working',
    success: 'Ready',
    error: 'Needs attention',
  };
  return <span className={`state-pill ${state}`}>{labels[state]}</span>;
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
