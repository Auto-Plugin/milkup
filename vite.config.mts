import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import vitePluginsAutoI18n, { YoudaoTranslator } from 'vite-auto-i18n-plugin'

const i18nPlugin = vitePluginsAutoI18n({
  deepScan: true,
  globalPath: './lang',
  namespace: 'lang',
  distPath: './dist/assets',
  distKey: 'index',
  targetLangList: ['ja', 'ko', 'ru', 'en', 'fr'],
  originLang: 'zh-cn',
  translator: new YoudaoTranslator({
    appId: '121c833175477478',
    appKey: 'c71283uowjPJM3GtM0UWCmU4m3AnIERp',
  }),
})

export default defineConfig({
  plugins: [vue(), i18nPlugin],
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
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@ui': path.resolve(__dirname, './src/renderer/components/ui'),
    },
  },
})
