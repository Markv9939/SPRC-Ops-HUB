import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.js'

export default defineConfig({
  ...baseConfig,
  testIgnore: [],
  testMatch: ['**/securityBootstrapPhase3.spec.js', '**/securityAccountActionsPhase4.spec.js'],
  use: {
    ...baseConfig.use,
    baseURL: 'http://127.0.0.1:4177'
  },
  webServer: {
    command: 'npm.cmd run dev -- --mode e2e --host 127.0.0.1 --port 4177',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: false,
    timeout: 120_000
  }
})
