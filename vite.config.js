import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const securityBootstrapEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(env.VITE_ENABLE_SECURITY_BOOTSTRAP_V3 || '').trim().toLowerCase()
  )

  return {
    plugins: [
      react(),
      {
        name: 'sprc-security-bootstrap-build-marker',
        transformIndexHtml: {
          order: 'post',
          handler: () => [{
            tag: 'meta',
            attrs: {
              name: 'sprc-security-bootstrap',
              content: securityBootstrapEnabled ? 'v3-enabled' : 'disabled'
            },
            injectTo: 'head'
          }]
        }
      }
    ],
    build: {
      // Current app bundle is ~1.2 MB minified; keep build output clean while we
      // defer deeper code-splitting work.
      chunkSizeWarningLimit: 1500
    }
  }
})
