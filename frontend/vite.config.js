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
        // 127.0.0.1 explicito, no "localhost": en esta maquina a veces resuelve
        // a ::1 (IPv6) y el backend solo escucha en IPv4, lo que daba 502.
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
