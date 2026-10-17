import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3105',
    trace: 'on-first-retry',
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  },
  projects: [
    {
      name: 'android-chrome',
      use: {
        ...devices['Pixel 7'],
        channel: 'chrome',
        viewport: { width: 360, height: 800 },
      },
    },
  ],
  webServer: {
    command: 'npx next start -p 3105',
    url: 'http://localhost:3105',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
