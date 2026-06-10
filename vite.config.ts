import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// DuckDB-WASM ships its own web worker + wasm. Excluding it from Vite's dep
// optimiser is mandatory, otherwise the bundled worker fails to start.
//
// `base` is '/' in dev and '/cohort-builder/' for production builds so the app
// can be served from a GitHub Pages project sub-path. Override at build time
// with VITE_BASE if the repo name differs.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.VITE_BASE || '/cohort-builder/' : '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  worker: {
    format: 'es',
  },
  // Large WASM assets: keep them as real files, don't inline.
  build: {
    assetsInlineLimit: 0,
    target: 'esnext',
  },
}));
