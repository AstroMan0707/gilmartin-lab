import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
// From vitest/config, not vite, so the `test` block below is typed.
import { defineConfig } from 'vitest/config'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  // Recorded in the app header and on the export's Read Me sheet, so a spreadsheet can
  // always be traced back to the version that produced it.
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    // Plotly is a large chunk on its own; splitting it keeps the app shell fast to load
    // and lets the browser cache it across app deploys.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('plotly.js-dist-min') ? 'plotly' : undefined),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
