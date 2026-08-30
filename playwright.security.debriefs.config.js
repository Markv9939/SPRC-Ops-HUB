import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.js'

export default defineConfig({
  ...baseConfig,
  testIgnore: [],
  testMatch: ['**/securityDebriefsAlertsStage.spec.js'],
  use: {
    ...baseConfig.use,
    baseURL: 'http://127.0.0.1:4180'
  },
  webServer: {
    command: 'node scripts/startSecurityE2eServer.js --port=4180',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    timeout: 120_000
  }
})
