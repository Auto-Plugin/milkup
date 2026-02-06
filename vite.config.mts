import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import vitePluginsAutoI18n, { EmptyTranslator } from 'vite-auto-i18n-plugin'
import electron from 'vite-plugin-electron'

const alias = {
  '@': path.resolve(__dirname, './src'),
  '@renderer': path.resolve(__dirname, './src/renderer'),
  '@ui': path.resolve(__dirname, './src/renderer/components/ui'),
}
const i18nPlugin = vitePluginsAutoI18n({
  deepScan: true,
  globalPath: './lang',
  namespace: 'lang',
  distPath: './dist/assets',
  distKey: 'index',
  targetLangList: ['ja', 'ko', 'ru', 'en', 'fr'],
  originLang: 'zh-cn',
  // translator: new YoudaoTranslator({
  //   appId: '121c833175477478',
  //   appKey: 'c71283uowjPJM3GtM0UWCmU4m3AnIERp',
  // }),
  translator: new EmptyTranslator(),
})

const electronPlugin = electron({
  entry: path.resolve(__dirname, 'src/main/index.ts'),
  onstart(options) {
    // 在 dev 时自动启动 Electron 主进程
    options.startup(['.', '--no-sandbox'])
  },
  vite: {
    resolve: {
      alias,
    },
  },
})
export default defineConfig({
  plugins: [vue(), i18nPlugin, electronPlugin],
  server: {
    open: false,
  },
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'main': path.resolve(__dirname, 'src/renderer/index.html'),
        'theme-editor': path.resolve(__dirname, 'src/renderer/theme-editor.html'),
      },
    },
  },
  resolve: {
    alias,
  },
})
