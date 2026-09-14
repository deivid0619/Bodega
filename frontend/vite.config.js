import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api al backend en desarrollo, igual que en Turify.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': {
        // 8001, no 8000: en esta maquina el 8000 ya lo usa el backend de Turify.
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
