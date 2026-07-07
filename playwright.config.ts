import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'playground-msedge',
      testMatch: /live-render\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:5174',
        channel: 'msedge',
      },
    },
    {
      name: 'desktop-msedge',
      testMatch: /desktop-shell\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:1420',
        channel: 'msedge',
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @milkup/playground dev',
      reuseExistingServer: false,
      url: 'http://127.0.0.1:5174',
    },
    {
      command: 'pnpm --filter @milkup/desktop dev',
      reuseExistingServer: false,
      url: 'http://127.0.0.1:1420',
    },
  ],
})
