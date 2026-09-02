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
  globalSetup: './tests/e2e/support/securityViteGlobalServer.js',
  webServer: undefined
})
