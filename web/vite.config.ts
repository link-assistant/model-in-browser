/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  // Vitest runs the unit tests under src/. The Playwright e2e specs under e2e/
  // are run separately via `npm run test:e2e`, so exclude them here (otherwise
  // Vitest tries to collect them and Playwright's test.describe throws).
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['smollm2-wasm'],
  },
  worker: {
    format: 'es',
  },
});
