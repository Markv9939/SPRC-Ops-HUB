import test from 'node:test'
import assert from 'node:assert/strict'
import { appCheckMonitoringDecision } from '../src/services/appCheckMonitoringModel.js'

test('App Check is disabled by default and requires the exact monitoring-only boundary', () => {
  assert.equal(appCheckMonitoringDecision({}).initialize, false)
  assert.equal(appCheckMonitoringDecision({ compileEnabled: true, version: 6, siteKey: 'test' }).initialize, false)
  assert.equal(appCheckMonitoringDecision({ compileEnabled: true, version: 7, siteKey: '' }).initialize, false)
  assert.equal(appCheckMonitoringDecision({ compileEnabled: true, version: 7, siteKey: 'test', useEmulators: true }).initialize, false)
  assert.equal(appCheckMonitoringDecision({ compileEnabled: true, version: 7, siteKey: 'test', enforcementEnabled: true }).initialize, false)
  assert.deepEqual(appCheckMonitoringDecision({ compileEnabled: true, version: 7, siteKey: 'test' }), {
    initialize: true,
    reason: 'monitoring_only'
  })
})
