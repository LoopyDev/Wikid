import { defineConfig, devices } from '@playwright/test';

// Browser tests: run against a live stack (see e2e/README.md).
//
// Each test signs in afresh and works in a workspace of its own, so they run side by side. The few
// that change something every session sees (an admin setting, or a user's own saved setting) are
// tagged @shared-state and run on their own, once the rest have finished.
const SHARED_STATE = /@shared-state/;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // E2E_WORKERS=1 runs them one at a time again, to rule out tests getting in each other's way
  workers: Number(process.env.E2E_WORKERS) || (process.env.CI ? 3 : 4),
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  outputDir: 'test-results',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: process.env.WIKID_BASE_URL || 'http://localhost:8088',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: SHARED_STATE },
    { name: 'shared-state', use: { ...devices['Desktop Chrome'] }, grep: SHARED_STATE, dependencies: ['chromium'] },
  ],
});
