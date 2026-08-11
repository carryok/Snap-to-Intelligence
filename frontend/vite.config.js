import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The frontend calls /api/* and Vite proxies it to FastAPI on :8000.
// Using the proxy instead of cross-origin fetch keeps dev free of CORS
// surprises (the backend also sets permissive CORS for the built bundle).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
