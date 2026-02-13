import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Current app bundle is ~1.2 MB minified; keep build output clean while we
    // defer deeper code-splitting work.
    chunkSizeWarningLimit: 1500
  }
})
