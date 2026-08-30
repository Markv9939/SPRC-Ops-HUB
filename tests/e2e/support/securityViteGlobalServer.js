/* global process */
import { createServer } from 'vite'

export default async function securityViteGlobalServer(config) {
  const baseUrl = new URL(String(config.projects[0]?.use?.baseURL || ''))
  const port = Number(baseUrl.port)
  if (baseUrl.hostname !== '127.0.0.1' || !Number.isInteger(port)) {
    throw new Error('Security browser tests require an explicit 127.0.0.1 baseURL port.')
  }
  process.env.VITE_ENABLE_SECURITY_BOOTSTRAP_V3 = 'true'
  const server = await createServer({
    mode: 'e2e',
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true
    }
  })
  await server.listen()
  return async () => {
    await server.close()
  }
}
