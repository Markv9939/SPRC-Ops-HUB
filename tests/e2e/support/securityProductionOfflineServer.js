/* global process */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { build } from 'vite'

async function waitForServer(url, serverProcess, getOutput) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Production preview exited early.\n${getOutput()}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The child process may still be binding its local port.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Production preview did not become ready.\n${getOutput()}`)
}

export default async function securityProductionOfflineServer(config) {
  const baseUrl = new URL(String(config.projects[0]?.use?.baseURL || ''))
  const port = Number(baseUrl.port)
  if (baseUrl.hostname !== '127.0.0.1' || !Number.isInteger(port)) {
    throw new Error('Production offline tests require an explicit 127.0.0.1 baseURL port.')
  }

  process.env.VITE_ENABLE_SECURITY_BOOTSTRAP_V3 = 'true'
  await build()
  const viteCli = resolve(process.cwd(), 'node_modules/vite/bin/vite.js')
  const output = []
  const serverProcess = spawn(process.execPath, [
    viteCli,
    'preview',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--strictPort'
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const capture = chunk => {
    output.push(String(chunk))
    if (output.length > 40) output.shift()
  }
  serverProcess.stdout.on('data', capture)
  serverProcess.stderr.on('data', capture)
  await waitForServer(baseUrl, serverProcess, () => output.join(''))

  return async () => {
    if (serverProcess.exitCode !== null) return
    serverProcess.kill()
    await Promise.race([
      new Promise(resolveExit => serverProcess.once('exit', resolveExit)),
      new Promise(resolveWait => setTimeout(resolveWait, 5_000))
    ])
  }
}
