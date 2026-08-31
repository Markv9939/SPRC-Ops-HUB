import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import securityProductionOfflineServer from '../tests/e2e/support/securityProductionOfflineServer.js'
import { runSecurityOfflineProcessRestart } from '../tests/e2e/support/securityOfflineProcessRestartRunner.js'

const baseURL = 'http://127.0.0.1:4191'
const profilePath = await mkdtemp(join(tmpdir(), 'sprc-offline-process-'))
let stopServer

try {
  stopServer = await securityProductionOfflineServer({
    projects: [{ use: { baseURL } }]
  })
  const evidence = await runSecurityOfflineProcessRestart({ baseURL, profilePath })
  if (evidence.cacheName !== 'sprc-ops-shell-v13') {
    throw new Error('The v13 production app shell was not cached before Chrome closed.')
  }
  if (!evidence.readyBeforeClose || !evidence.offlineRootWasNonblank || !evidence.offlinePinWasVisible) {
    throw new Error(`Full-process offline restart evidence was incomplete: ${JSON.stringify(evidence)}`)
  }
  console.log('Full Chrome process offline restart passed:', evidence)
} finally {
  if (stopServer) await stopServer()
  const resolvedProfilePath = resolve(profilePath)
  const resolvedTempRoot = resolve(tmpdir())
  if (resolvedProfilePath.startsWith(`${resolvedTempRoot}${sep}`)) {
    await rm(resolvedProfilePath, { recursive: true, force: true })
  }
}
