import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.smoke.ts',
  timeout: 30_000,
  retries: 1,
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8787',
    reuseExistingServer: true,
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://localhost:8787',
    headless: true,
  },
});
