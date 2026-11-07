import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:8787', headless: true, actionTimeout: 15000, navigationTimeout: 30000, launchOptions: { executablePath: process.env.DIMA_CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--disable-dev-shm-usage'] } },
});
