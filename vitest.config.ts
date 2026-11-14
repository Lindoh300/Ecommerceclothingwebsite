import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts so the React Router plugin does not load in tests.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
