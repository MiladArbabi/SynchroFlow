// CommonJS-compatible jest setup file (loaded before modules)
// Keep this file free of ESM `import` so Jest can require() it early.

// Optional: bring in DOM matchers if available in node_modules via require.
try { require('@testing-library/jest-dom'); } catch (e) { /* optional dev dep */ }

// Ensure test environment is set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Ensure queue code is disabled in tests to avoid background connections / logs / open handles
process.env.DISABLE_QUEUE = '1';

// Polyfill for TextEncoder/TextDecoder which are not available in JSDOM
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.ResizeObserver = require('resize-observer-polyfill');

// Mock EventSource for JSDOM
global.EventSource = jest.fn(() => ({
  onopen: jest.fn(),
  addEventListener: jest.fn(),
  onerror: jest.fn(),
  close: jest.fn(),
}));

// Mock Vite's import.meta.env (some frontend code reads import.meta.env during module init)
Object.defineProperty(global, 'import', {
  value: { meta: { env: { VITE_APP_VERSION: 'test-version' } } },
  writable: true,
});

// Silence noisy console.error in tests (optional)
try { jest.spyOn(console, 'error').mockImplementation(() => {}); } catch (_) {}

// Lightweight recharts mock so node tests don't require DOM layout
jest.mock('recharts', () => {
  const OriginalModule = jest.requireActual('recharts');
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }) => children,
  };
});

// ─────────────────────────────────────────────
// Mock Vite virtual module registry for Jest
// ─────────────────────────────────────────────
jest.mock('virtual:lasyncro-modules', () => {
  return [
    {
      id: 'order-nexus',
      load: async () => ({
        default: require('./modules/order-nexus-test/ModuleEntry.stub.js').descriptor
      })
    }
  ];
});
