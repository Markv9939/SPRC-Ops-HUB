/* global process */
import { build, preview } from 'vite'

export default async function securityProductionOfflineServer(config) {
  const baseUrl = new URL(String(config.projects[0]?.use?.baseURL || ''))
  const port = Number(baseUrl.port)
  if (baseUrl.hostname !== '127.0.0.1' || !Number.isInteger(port)) {
    throw new Error('Production offline tests require an explicit 127.0.0.1 baseURL port.')
  }

  process.env.VITE_ENABLE_SECURITY_BOOTSTRAP_V3 = 'true'
  await build()
  const server = await preview({
    preview: {
      host: '127.0.0.1',
      port,
      strictPort: true
    }
  })

  return async () => {
    await new Promise((resolve, reject) => {
      server.httpServer.close(error => error ? reject(error) : resolve())
    })
  }
}
