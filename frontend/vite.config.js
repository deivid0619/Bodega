import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api al backend en desarrollo, igual que en Turify.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
