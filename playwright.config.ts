import { defineConfig } from '@playwright/test'

const DATA_DIR = 'test-results/e2e-data'
// One timezone for the app, the fake Up data and the specs (workers inherit it), so local month and
// pay-cycle boundaries agree at any hour of the day.
const TZ = 'Australia/Sydney'
process.env.TZ = TZ

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  outputDir: 'test-results/playwright',
  use: {
    baseURL: 'http://localhost:4173',
    // The locally installed Chrome; no browser download needed.
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    // Deterministic screenshots, and exercises the reduced-motion path (no chart entry animation).
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  // One server and database for the run: the budgets flow continues from the foundation flow's account.
  projects: [
    { name: 'foundation', testMatch: 'foundation.spec.ts' },
    { name: 'budgets', testMatch: 'budgets.spec.ts', dependencies: ['foundation'] },
    { name: 'goals-debts', testMatch: 'goals-debts.spec.ts', dependencies: ['foundation'] },
    { name: 'visuals', testMatch: 'visuals.spec.ts', dependencies: ['budgets', 'goals-debts'], teardown: 'sharing' },
    // A teardown of visuals so it runs last, even if visuals fails: it adds a partner, which stays in the database.
    { name: 'sharing', testMatch: 'sharing.spec.ts' },
  ],
  webServer: [
    {
      command: 'pnpm exec tsx scripts/fake-up-server.ts',
      url: 'http://localhost:4010/api/v1/util/ping', // 401 without a token = ready
      env: { FAKE_UP_PORT: '4010', TZ },
      reuseExistingServer: false,
    },
    {
      command: `node -e "require('fs').rmSync('${DATA_DIR}',{recursive:true,force:true})" && pnpm build && node dist/server/index.js`,
      url: 'http://localhost:4173/api/setup/status',
      timeout: 180_000,
      env: {
        PORT: '4173',
        DATA_DIR,
        UP_API_BASE_URL: 'http://localhost:4010/api/v1',
        TZ,
        SYNC_INTERVAL_MINUTES: '1',
      },
      reuseExistingServer: false,
    },
  ],
})
