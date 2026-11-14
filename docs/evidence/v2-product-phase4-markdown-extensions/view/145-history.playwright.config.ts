import config from '/workspace/milkup/playwright.config'
export default {
  ...config,
  testDir: '/workspace/milkup-markdown-extensions-phase4-evidence/view',
  projects: [{ ...config.projects![1], testMatch: /145-history-diagnostic\.spec\.ts/ }],
  webServer: (config.webServer as any[]).map((server) => ({ ...server, cwd: '/workspace/milkup' })),
}
