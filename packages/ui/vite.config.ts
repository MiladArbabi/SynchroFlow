import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // Explicitly set the port for the UI dev server
    proxy: {
      // Proxy requests from /api to the backend API server
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Remove the '/api' prefix before sending to the backend
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  resolve: {
    alias: {
      // Map 'assets' to the correct absolute path
      'assets': path.resolve(__dirname, './src/assets'),
    },
  },
})