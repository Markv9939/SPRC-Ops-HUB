import { readFileSync } from 'node:fs'
import process from 'node:process'
import { evaluateCompatibilityRetirementSources } from './securityCompatibilityRetirementModel.js'

const read = path => readFileSync(path, 'utf8')
const allowPending = process.argv.includes('--allow-pending')

const report = evaluateCompatibilityRetirementSources({
  pinLogin: read('src/components/PinLogin.jsx'),
  app: read('src/App.jsx'),
  sessionModel: read('src/services/securityClientSessionModel.js'),
  userPinService: read('src/services/userPinService.js'),
  supervisorDashboard: read('src/components/SupervisorDashboard.jsx'),
  staffPinLoginService: read('functions/src/staffPinLoginService.js'),
  functionsIndex: read('functions/src/index.js'),
  firestoreRules: read('firestore.rules'),
  storageRules: read('storage.rules')
})

console.log(JSON.stringify({
  mode: allowPending ? 'retirement_inventory' : 'retirement_release_gate',
  ...report
}, null, 2))

if (!report.retired && !allowPending) process.exitCode = 1
