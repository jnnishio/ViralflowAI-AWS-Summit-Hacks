/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      // jsdom defaults to the opaque "about:blank" origin, under which
      // window.localStorage is unavailable. A real http(s) URL gives the
      // test environment a proper origin so localStorage works (used by
      // src/api/auth.ts's token storage).
      jsdom: { url: 'http://localhost:3000' },
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Node >=22's experimental global Web Storage API shadows jsdom's
    // window.localStorage with an unusable stub (see
    // https://github.com/vitest-dev/vitest/issues/8757). `execArgv` is the
    // Vitest 4 top-level replacement for the removed `poolOptions.forks.
    // execArgv`; it disables that flag in the test worker so jsdom's
    // localStorage (used by src/api/auth.ts) works.
    execArgv: ['--no-experimental-webstorage'],
  },
})
