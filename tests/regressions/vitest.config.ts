import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['v1/**/*.test.ts', 'policy/**/*.test.ts'],
  },
})
