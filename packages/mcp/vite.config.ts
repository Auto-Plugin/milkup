import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/bin/milkup-mcp.ts',
      fileName: () => 'milkup-mcp.js',
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
