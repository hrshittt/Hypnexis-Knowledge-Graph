import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend for the dev proxy. 127.0.0.1 (not "localhost") because uvicorn binds IPv4 only;
// "localhost" can resolve to ::1 first on Windows and produce ECONNREFUSED noise.
const API_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        // keep the canvas graph engine and markdown renderer out of the app chunk
        manualChunks: {
          graph: ['react-force-graph-2d'],
          markdown: ['react-markdown'],
        },
      },
    },
  },
})
