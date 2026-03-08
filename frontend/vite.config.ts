import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8991,
    proxy: {
      '/api': {
        target: 'http://localhost:8990',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
