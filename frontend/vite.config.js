import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Bodega tiene puertos propios: pagina 5190 y servidor 8090. Turify, el otro
// proyecto de esta maquina, usa 5173, 5180, 8000 y 8001; compartir puerto
// mezclaria la sesion y los datos de los dos en el navegador. strictPort: si
// el puerto esta ocupado, Vite falla en vez de saltar a otro.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    strictPort: true,
    proxy: {
      '/api': {
        // 127.0.0.1 explicito, no "localhost": en esta maquina a veces resuelve
        // a ::1 (IPv6) y el backend solo escucha en IPv4, lo que daba 502.
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      },
    },
  },
  // la version de produccion instala el service worker: tampoco en el 4173 de todos
  preview: {
    port: 4190,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
  },
})
