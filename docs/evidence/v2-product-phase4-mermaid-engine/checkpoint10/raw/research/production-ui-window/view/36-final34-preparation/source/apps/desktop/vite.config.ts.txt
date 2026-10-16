import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))
execFileSync(process.execPath, ['scripts/check-versions.mjs'], { cwd: workspaceRoot })
const appVersion = JSON.parse(readFileSync(`${workspaceRoot}/package.json`, 'utf8')).version
const sdkVersion = JSON.parse(
  readFileSync(`${workspaceRoot}/packages/plugin-sdk/package.json`, 'utf8'),
).version
const packageSource = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  clearScreen: false,
  define: {
    __MILKUP_VERSION__: JSON.stringify(appVersion),
    __MILKUP_PLUGIN_SDK_VERSION__: JSON.stringify(sdkVersion),
  },
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
