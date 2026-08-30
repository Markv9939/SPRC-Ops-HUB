import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.js'

export default defineConfig({
  ...baseConfig,
  testIgnore: [],
  testMatch: ['**/securityOfflineReconnectMatrix.spec.js'],
  globalSetup: './tests/e2e/support/securityViteGlobalServer.js',
  webServer: undefined,
  projects: [baseConfig.projects[0]],
  use: {
    ...baseConfig.use,
    baseURL: 'http://127.0.0.1:4186',
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  }
})
