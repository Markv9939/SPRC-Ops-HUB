import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.js'

export default defineConfig({
  ...baseConfig,
  testIgnore: [],
  testMatch: ['**/securitySettingsStage.spec.js'],
  use: {
    ...baseConfig.use,
    baseURL: 'http://127.0.0.1:4184'
  },
  webServer: {
    command: 'node scripts/startSecurityE2eServer.js --port=4184',
    url: 'http://127.0.0.1:4184',
    reuseExistingServer: false,
    timeout: 120_000
  }
})
