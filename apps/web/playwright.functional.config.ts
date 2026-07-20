import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const state = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../.drone-works/local/state.json'),
    'utf8',
  ),
) as { readonly endpoints: { readonly web: string } };

export default defineConfig({
  testDir: './test/functional',
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'line',
  timeout: 300_000,
  use: {
    baseURL: state.endpoints.web,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
