import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/bin/milkup.ts',
      fileName: () => 'milkup.js',
      formats: ['es'],
    },
    outDir: 'dist/bin',
    rollupOptions: {
      external: [/^node:/u],
    },
    ssr: true,
    target: 'node22',
  },
})
