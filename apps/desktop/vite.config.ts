import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))
const packageSource = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  clearScreen: false,
  resolve: {
    alias: {
      '@milkup/assets': packageSource('assets'),
      '@milkup/core': packageSource('core'),
      '@milkup/input': packageSource('input'),
      '@milkup/markdown': packageSource('markdown'),
      '@milkup/plugin': packageSource('plugin'),
      '@milkup/tauri-bridge': packageSource('tauri-bridge'),
      '@milkup/view-dom': packageSource('view-dom'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    fs: {
      allow: [workspaceRoot],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
})
