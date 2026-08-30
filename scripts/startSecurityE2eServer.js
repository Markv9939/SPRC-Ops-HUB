/* global process */
import { spawn } from 'node:child_process'

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

const port = argument('port')
if (!/^\d{4,5}$/.test(port)) throw new Error('Use --port=<local test port>.')

const child = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--mode', 'e2e',
  '--host', '127.0.0.1',
  '--port', port
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_ENABLE_SECURITY_BOOTSTRAP_V3: 'true'
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', code => {
  process.exitCode = Number.isInteger(code) ? code : 1
})
