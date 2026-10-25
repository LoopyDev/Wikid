import { defineConfig, devices } from '@playwright/test';

// Browser tests: run against a live stack (see e2e/README.md).
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Tests share the demo users and workspace, so run them one at a time.
  workers: 1,
  fullyParallel: false,
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
