import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const alphaOrganizationId = '00000000-0000-4000-8000-0000000000a1';
const betaOrganizationId = '00000000-0000-4000-8000-0000000000b1';
const uploadId = '10000000-0000-4000-8000-000000000010';
const objectVersionId = '10000000-0000-4000-8000-000000000011';
const flightId = '10000000-0000-4000-8000-000000000012';

const problem = (status: number, detail: string) => ({
  type: `https://drone.works/problems/${status}`,
  title: status === 404 ? 'Not Found' : 'Request Failed',
  status,
  detail,
  instance: '/api/v1/test',
  correlation_id: `browser-${status}`,
});

const summary = {
  flight_id: flightId,
  state: 'active',
  assignment_status: 'assigned',
  source_kind: 'imported',
  pilot_profile_id: '10000000-0000-4000-8000-000000000020',
  pilot_display_name: 'Generated Pilot A',
  proposed_pilot_profile_id: null,
  aircraft_id: '10000000-0000-4000-8000-000000000021',
  aircraft_display_name: 'Survey One',
  takeoff_timezone: 'Asia/Dubai',
  revision_number: 2,
  capabilities: ['telemetry.altitude', 'telemetry.position'],
  facts: {
    aircraft_model: { origin: 'imported', value: 'Generated Mavic' },
    aircraft_name: { origin: 'user_override', value: 'Survey One' },
    application_platform: { origin: 'imported', value: 'DJI Fly' },
    application_version: { origin: 'imported', value: '1.14' },
    distance_m: { origin: 'derived', value: 1250.4 },
    duration_ms: { origin: 'imported', value: 60000 },
    max_height_m: { origin: 'derived', value: 82.3 },
    max_horizontal_speed_mps: { origin: 'derived', value: 9.2 },
    max_vertical_speed_mps: { origin: 'derived', value: 2.1 },
    takeoff_time_utc: { origin: 'imported', value: '2026-07-17T08:00:00.000Z' },
  },
  telemetry: { sample_count: 5, first_elapsed_ms: 0, last_elapsed_ms: 4000 },
};

const positions = [
  [55.111123, 25.222123],
  [55.111523, 25.222523],
  null,
  [55.112123, 25.223123],
  [55.112523, 25.223523],
] as const;

const track = {
  flight_id: flightId,
  revision_number: 2,
  mode: 'default',
  capabilities: ['telemetry.altitude', 'telemetry.position'],
  source_sample_count: 5,
  returned_sample_count: 5,
  next_cursor: null,
  gap_transition_count: 2,
  preserved_gap_transition_count: 2,
  statistics: {
    altitude_msl_m: { minimum: 14, maximum: 24 },
    battery_charge_percent: { minimum: null, maximum: null },
    height_agl_m: { minimum: 0, maximum: 10 },
    horizontal_speed_mps: { minimum: null, maximum: null },
    vertical_speed_mps: { minimum: null, maximum: null },
  },
  samples: positions.map((position, sample_index) => ({
    sample_index,
    elapsed_ms: sample_index * 1000,
    position: position
      ? { longitude_deg: position[0], latitude_deg: position[1] }
      : null,
    altitude_msl_m: position ? 14 + sample_index : null,
    height_agl_m: position ? sample_index : null,
    horizontal_speed_mps: null,
    vertical_speed_mps: null,
    battery_charge_percent: null,
    gps_satellites: null,
    gps_signal_level: null,
    signal_downlink_percent: null,
    signal_uplink_percent: null,
  })),
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType:
      status >= 400 ? 'application/problem+json' : 'application/json',
    status,
  });
}

async function installApi(
  page: Page,
  options: {
    failureReason?: 'unsupported' | 'corrupt' | 'key_unavailable';
    denyOrganization?: boolean;
    noPosition?: boolean;
  } = {},
) {
  let polls = 0;
  let trackRequests = 0;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/_local/generated-personas/select') {
      const persona = JSON.parse(request.postData() ?? '{}').persona;
      return json(route, { persona, token: `${persona}-token` });
    }
    if (path.endsWith('/selection') && request.method() === 'PUT') {
      if (options.denyOrganization) {
        return json(
          route,
          problem(404, 'The requested organization resource was not found.'),
          404,
        );
      }
      const organizationId = path.split('/')[4];
      return json(route, {
        organization_id: organizationId,
        name:
          organizationId === betaOrganizationId
            ? 'Generated Beta'
            : 'Generated Alpha',
        default_timezone: 'Asia/Dubai',
        unit_system: 'metric',
        role: 'owner',
        pilot_profile_id: '10000000-0000-4000-8000-000000000020',
      });
    }
    if (path.endsWith('/uploads') && request.method() === 'POST') {
      return json(
        route,
        {
          upload_id: uploadId,
          state: 'declared',
          content_sha256: 'a'.repeat(64),
        },
        201,
      );
    }
    if (path.endsWith(`/${uploadId}/content`) && request.method() === 'PUT') {
      return json(route, {
        upload_id: uploadId,
        object_version_id: objectVersionId,
        content_sha256: 'a'.repeat(64),
      });
    }
    if (
      path.endsWith(`/${uploadId}/completion`) &&
      request.method() === 'POST'
    ) {
      return json(route, {
        upload_id: uploadId,
        raw_source_id: uploadId,
        object_version_id: objectVersionId,
        state: 'completed',
        content_sha256: 'a'.repeat(64),
      });
    }
    if (path.endsWith(`/imports/${uploadId}`)) {
      polls += 1;
      const failed = options.failureReason;
      const completed = polls > 1;
      return json(route, {
        import_id: uploadId,
        state: failed ? 'failed' : completed ? 'completed' : 'queued',
        failure_reason: failed ?? null,
        result_flight_id: failed || !completed ? null : flightId,
        updated_at: '2026-07-17T12:00:00.000Z',
      });
    }
    if (path.endsWith('/flights') && request.method() === 'GET') {
      const organizationId = path.split('/')[4];
      const item = {
        ...summary,
        flight_id:
          organizationId === betaOrganizationId
            ? '10000000-0000-4000-8000-000000000099'
            : flightId,
        aircraft_display_name:
          organizationId === betaOrganizationId
            ? 'Generated Aircraft B'
            : 'Survey One',
      };
      return json(route, {
        items: [item],
        next_cursor: null,
        totals: {
          active_flights: 1,
          awaiting_review: 0,
          total_distance_m: 1250.4,
          total_duration_ms: 60000,
        },
      });
    }
    if (path.endsWith(`/flights/${flightId}/track`)) {
      trackRequests += 1;
      return json(route, track);
    }
    if (path.endsWith(`/flights/${flightId}`)) {
      return json(
        route,
        options.noPosition
          ? { ...summary, capabilities: [], telemetry: null }
          : summary,
      );
    }
    await route.continue();
  });
  return { trackRequests: () => trackRequests };
}

async function enterAlpha(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Generated Alpha owner' }).click();
  await expect(page.getByText('Active persona: alpha owner')).toBeVisible();
  await page.getByRole('button', { name: 'Enter organization' }).click();
  await expect(page.getByTestId('organization-state')).toContainText(
    'Generated Alpha',
  );
  await expect(page.getByTestId('flight-totals')).toContainText('1');
  await expect(page.getByText('Survey One').first()).toBeVisible();
}

test('uploads, polls, opens a capability-aware local track, and clears organization state', async ({
  page,
}) => {
  const requests: Array<{ method: string; url: string; body: string }> = [];
  page.on('request', (request) => {
    requests.push({
      method: request.method(),
      url: request.url(),
      body: request.postData() ?? '',
    });
  });
  await installApi(page);
  await enterAlpha(page);
  await page.getByLabel('Select a DJI source log').setInputFiles({
    name: 'supported-v14.txt',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('generated supported source'),
  });
  await page.getByRole('button', { name: 'Upload and process' }).click();
  await expect(page.getByTestId('flight-detail')).toBeVisible();
  await expect(page.getByTestId('flight-map')).toBeVisible();
  await expect(page.getByText('Provider-free local canvas.')).toBeVisible();
  await expect(page.locator('canvas[role="img"]')).toHaveAttribute(
    'aria-label',
    'Capability-supported two-dimensional flight track',
  );

  const mutations = requests.filter(
    ({ method }) => !['GET', 'HEAD', 'OPTIONS'].includes(method),
  );
  expect(mutations.length).toBeGreaterThan(0);
  for (const mutation of mutations) {
    const path = new URL(mutation.url).pathname;
    expect(
      path.startsWith('/api/v1/') ||
        path === '/_local/generated-personas/select' ||
        path === '/security/csp-report',
    ).toBe(true);
  }
  for (const request of requests) {
    if (!request.url.startsWith('http')) continue;
    const url = new URL(request.url);
    expect(url.hostname).toBe('127.0.0.1');
    if (!url.pathname.startsWith('/api/v1/')) {
      expect(`${request.url}${request.body}`).not.toContain('55.111123');
      expect(`${request.url}${request.body}`).not.toContain('25.222123');
    }
    expect(url.pathname).not.toMatch(/tile|style/i);
  }

  const accessibility = await new AxeBuilder({ page })
    .include('main')
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole('button', { name: 'Generated Beta owner' }).click();
  await expect(page.getByTestId('flight-detail')).toHaveCount(0);
  await expect(page.getByTestId('organization-state')).toHaveText(
    'Organization-bound data is empty.',
  );
  await page.getByRole('button', { name: 'Enter organization' }).click();
  await expect(page.getByTestId('organization-state')).toContainText(
    'Generated Beta',
  );
  await expect(page.getByTestId('flight-detail')).toHaveCount(0);
  await expect(page.getByText('Generated Aircraft B')).toBeVisible();
  await expect(page.getByText('Survey One')).toHaveCount(0);
});

for (const [reason, message] of [
  ['unsupported', 'not one of the explicitly supported DJI formats'],
  ['corrupt', 'corrupt or malformed'],
  ['key_unavailable', 'needs a key that is currently unavailable'],
] as const) {
  test(`shows the distinct ${reason} processing outcome`, async ({ page }) => {
    await installApi(page, { failureReason: reason });
    await enterAlpha(page);
    await page.getByLabel('Select a DJI source log').setInputFiles({
      name: `${reason}.txt`,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(`generated ${reason}`),
    });
    await page.getByRole('button', { name: 'Upload and process' }).click();
    await expect(page.locator('.error-banner')).toContainText(message);
    await expect(page.getByTestId('flight-detail')).toHaveCount(0);
  });
}

test('keeps authorization failure distinct and redacted', async ({ page }) => {
  await installApi(page, { denyOrganization: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Generated Alpha owner' }).click();
  await page.getByRole('button', { name: 'Enter organization' }).click();
  await expect(page.locator('.error-banner')).toContainText(
    'not available to the current organization membership',
  );
  await expect(page.locator('.error-banner')).not.toContainText(
    alphaOrganizationId,
  );
});

test('does not request a track when position capability is absent', async ({
  page,
}) => {
  const api = await installApi(page, { noPosition: true });
  await enterAlpha(page);
  await page.getByLabel('Flight ID').fill(flightId);
  await page
    .getByRole('region', { name: 'Open the flight summary' })
    .getByRole('button', { name: 'Open flight' })
    .click();
  await expect(page.getByText('Track unavailable')).toBeVisible();
  expect(api.trackRequests()).toBe(0);
});

test('enforces a provider-free CSP and accepts payload-free reports', async ({
  request,
}) => {
  const page = await request.get('/');
  const csp = page.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain('report-uri /security/csp-report');
  expect(csp).not.toMatch(/https?:\/\//);
  const report = await request.post('/security/csp-report', {
    data: { 'csp-report': { 'violated-directive': 'generated-test' } },
    headers: { 'content-type': 'application/csp-report' },
  });
  expect(report.status()).toBe(204);
  expect(report.headers()['cache-control']).toBe('no-store');
});
