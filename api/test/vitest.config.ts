import { defineConfig } from 'vitest/config';

// API end-to-end tests: run against a live stack (see api/test/README.md).
export default defineConfig({
  test: {
    root: __dirname,
    include: ['**/*.e2e.test.ts'],
    globalSetup: ['./global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Files share the demo users, so run them one at a time.
    fileParallelism: false,
  },
});
