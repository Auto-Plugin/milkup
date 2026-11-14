import { defineConfig, devices } from '/workspace/milkup/node_modules/@playwright/test/index.mjs'
export default defineConfig({
  testDir: '.',
  testMatch: 'controlled-footnote.spec.ts',
  timeout: 60000,
  expect: { timeout: 5000 },
  retries: 0,
  workers: 1,
  outputDir: './controlled-after',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:1420',
    ...(process.env.MILKUP_BROWSER_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.MILKUP_BROWSER_EXECUTABLE } }
      : { channel: process.env.MILKUP_BROWSER_CHANNEL ?? 'msedge' }),
  },
})
