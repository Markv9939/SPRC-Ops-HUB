import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/securityOfflineProductionShell.spec.js'],
  globalSetup: './tests/e2e/support/securityProductionOfflineServer.js',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4191',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [{
    name: 'mobile-production-shell',
    use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } }
  }],
  webServer: undefined
})
