import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'server', environment: 'node', include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'web', environment: 'jsdom', include: ['tests/web/**/*.test.{ts,tsx}'], setupFiles: ['tests/web/setup.ts'] },
      },
    ],
  },
})
