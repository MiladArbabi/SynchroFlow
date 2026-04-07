//apps/frontend/vite.config.ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import lasyncroModulesPlugin from './vite-plugins/vite-plugin-lasyncro-modules';

// https://vitejs.dev/config/
import { fileURLToPath } from 'node:url';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    lasyncroModulesPlugin(),
    react(),
    tsconfigPaths(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // prefer IPv4 loopback explicitly to avoid ::1 vs 127.0.0.1 mismatch
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (_proxyReq, req, _res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        }
      }
    }
},
  resolve: {
    alias: {
      // --- BERRY'S NEW ALIASES ---
      'config': path.resolve(__dirname, './src/config.ts'),
      'hooks': path.resolve(__dirname, './src/hooks'),
      'themes': path.resolve(__dirname, './src/themes'),
      'utils': path.resolve(__dirname, './src/utils'),
      'ui-component': path.resolve(__dirname, './src/ui-component'),
      'layout': path.resolve(__dirname, './src/layout'),
      'menu-items': path.resolve(__dirname, './src/menu-items'),
      'api': path.resolve(__dirname, './src/api'),
      
      // --- OUR EXISTING ALIASES ---
      '@lasyncro/shared/ui': path.resolve(__dirname, '../../modules/shared/src/ui'),
      'assets': path.resolve(__dirname, './src/assets'),
      'components': path.resolve(__dirname, './src/components'),
      'context': path.resolve(__dirname, './src/contexts/MaterialUI.tsx'),
      'contexts': path.resolve(__dirname, './src/contexts'),
      'examples': path.resolve(__dirname, './src/components'),
      'layouts': path.resolve(__dirname, './src/layouts'),
      'routes': path.resolve(__dirname, './src/routes.tsx'),
      'widgets': path.resolve(__dirname, './src/widgets'),

      // Map the bare 'runtime' to the runtime folder (so imports like 'runtime/registerRoute' resolve)
      'runtime': path.resolve(__dirname, './src/runtime'),
      // also map bare 'runtime/index' -> explicit index file (optional)
      'runtime/index': path.resolve(__dirname, './src/runtime/index.ts'),
      // --- TEMP: force Vite to resolve built customers module ---
      '@lasyncro/customers': path.resolve(
        __dirname,
        '../../modules/customers/dist/index.js'
      ),
      '@lasyncro/fulfillment': path.resolve(
        __dirname,
        '../../modules/fulfillment/src/ui/index.ts'
      ),
      '@lasyncro/alerts': path.resolve(
        __dirname,
        '../../modules/alerts/src/ui/index.ts'
      ),
    }
  },
});