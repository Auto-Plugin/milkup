import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// A clean host checkout has no independently installed plugin node_modules.
// Test against exactly the SDK's public export, as the distribution build does.
export default defineConfig({
  resolve: {
    alias: {
      '@milkup/plugin-sdk': fileURLToPath(
        new URL('../../packages/plugin-sdk/src/index.js', import.meta.url),
      ),
    },
  },
  test: { include: ['plugins/outline/src/**/*.test.ts'] },
})
