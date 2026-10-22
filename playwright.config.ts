import { defineConfig, devices } from '@playwright/test'

// Keep the established Edge default; CI/Linux can use an installed Chromium explicitly.
const browser = process.env.MILKUP_BROWSER_EXECUTABLE
  ? { launchOptions: { executablePath: process.env.MILKUP_BROWSER_EXECUTABLE } }
  : { channel: process.env.MILKUP_BROWSER_CHANNEL ?? 'msedge' }

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
        ...browser,
      },
    },
    {
      name: 'desktop-msedge',
      testMatch:
        /desktop-(?:shell|sidebar-resize|code-blocks|visual-fixes|updates|plugin-cards|plugin-tree|plugin-forms|workspace|preferences|shortcuts|formatting|images|markdown-extensions)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:1420',
        ...browser,
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
