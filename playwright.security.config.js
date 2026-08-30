import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.js'

export default defineConfig({
  ...baseConfig,
  testIgnore: [],
  testMatch: ['**/securityBootstrapPhase3.spec.js', '**/securityAccountActionsPhase4.spec.js'],
  globalSetup: './tests/e2e/support/securityViteGlobalServer.js',
  webServer: undefined,
  use: {
    ...baseConfig.use,
    baseURL: 'http://127.0.0.1:4177'
  }
})
