import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.js'

export default defineConfig({
  ...baseConfig,
  testIgnore: [],
  testMatch: ['**/securityIssuesFeedbackAuditStage.spec.js'],
  use: {
    ...baseConfig.use,
    baseURL: 'http://127.0.0.1:4181'
  },
  webServer: {
    command: 'node scripts/startSecurityE2eServer.js --port=4181',
    url: 'http://127.0.0.1:4181',
    reuseExistingServer: false,
    timeout: 120_000
  }
})
