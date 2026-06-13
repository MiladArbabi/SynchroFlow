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
      // analytics alias required for central event pipeline (prevents dead module tree-shaking)
      'analytics': path.resolve(__dirname, './src/analytics'),
      'activation': path.resolve(__dirname, './src/activation'),
      
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
      '@lasyncro/returns': path.resolve(
        __dirname,
        '../../modules/returns/src/ui/index.ts'
      ),
      '@lasyncro/cashflow': path.resolve(
        __dirname,
        '../../modules/cashflow/src/ui/index.ts'
      ),
      '@lasyncro/demand': path.resolve(
        __dirname,
        '../../modules/demand/src/ui/index.ts'
      ),
      '@lasyncro/wms': path.resolve(
        __dirname,
        '../../modules/wms/src/ui/index.ts'
      ),
      '@lasyncro/problem-center': path.resolve(
        __dirname,
        '../../modules/problem-center/src/ui/index.ts'
      ),
    }
  },
  build: {
    /**
     * BUNDLE SPLITTING (FLY-03)
     * ──────────────────────────
     * Splits the 2.8MB monolith into cacheable vendor chunks.
     * Browsers cache vendor chunks across deploys (content-hashed filenames).
     * Users who return after a deploy only re-download changed app chunks.
     *
     * Split strategy:
     * - vendor-react:     React core — tiny, always needed, ultra-stable
     * - vendor-mui:       MUI + Emotion — largest single contributor (~600KB)
     * - vendor-mui-icons: Icon libraries — large trees, cached separately
     * - vendor-charts:    Chart libs — only needed on analytics/finance pages
     * - vendor-tanstack:  Data fetching/table/virtual — loaded post-auth
     * - vendor-forms:     Formik + Yup — auth pages only
     * - vendor-utils:     Utilities — posthog, axios, lodash, date handling
     *
     * WARNING: do not merge vendor-mui and vendor-mui-icons — icons alone
     * are large enough that splitting them improves cache hit rate when
     * icon sets change between deploys.
     */
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // React core — always loaded, must be its own chunk
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/') ||
              id.includes('node_modules/react-router/')) {
            return 'vendor-react';
          }

          // MUI icons + icon libraries — large, separate cache
          if (id.includes('node_modules/@mui/icons-material') ||
              id.includes('node_modules/@tabler/icons-react') ||
              id.includes('node_modules/lucide-react')) {
            return 'vendor-mui-icons';
          }

          // MUI core + Emotion — biggest chunk
          if (id.includes('node_modules/@mui/') ||
              id.includes('node_modules/@emotion/')) {
            return 'vendor-mui';
          }

          // Chart libraries — only needed on analytics/finance pages
          if (id.includes('node_modules/apexcharts') ||
              id.includes('node_modules/react-apexcharts') ||
              id.includes('node_modules/chart.js') ||
              id.includes('node_modules/react-chartjs-2') ||
              id.includes('node_modules/recharts') ||
              id.includes('node_modules/d3') ||
              id.includes('node_modules/d3-')) {
            return 'vendor-charts';
          }

          // TanStack — data fetching, table, virtualisation
          if (id.includes('node_modules/@tanstack/')) {
            return 'vendor-tanstack';
          }

          // Forms — Formik + Yup — auth pages only
          if (id.includes('node_modules/formik') ||
              id.includes('node_modules/yup')) {
            return 'vendor-forms';
          }

          // Utilities — analytics, HTTP, dates, helpers
          if (id.includes('node_modules/posthog-js') ||
              id.includes('node_modules/axios') ||
              id.includes('node_modules/lodash-es') ||
              id.includes('node_modules/lodash') ||
              id.includes('node_modules/date-fns')) {
            return 'vendor-utils';
          }
        },
      },
    },
  },
});