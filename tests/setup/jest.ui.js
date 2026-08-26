// tests/setup/jest.ui.js
//
// TEST-INFRA-FOUNDATION Slice 1B.
//
// JSDOM/UI Jest setup for the frontend project only. Loaded via
// `setupFilesAfterEnv` (runs after the test framework/expect is installed),
// matching how this UI-only content was already loaded for the frontend
// (and formerly api-ui) projects prior to this slice.
//
// Every concern below was proven UI-only by Slice 1B's preflight: zero
// backend-legacy/backend-integration/contract test (or anything in their
// transitive import graph) references any of these, and each one's own
// comment already states a JSDOM/frontend reason for existing.

require('./jest.shared.js');

// Bring in DOM matchers if available in node_modules via require.
try { require('@testing-library/jest-dom'); } catch (e) { /* optional dev dep */ }

// Polyfill for TextEncoder/TextDecoder which are not available in JSDOM.
// (Node provides these natively already, so this is a JSDOM-only gap-filler —
// no backend-legacy/backend-integration/contract test references either.)
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
        default: require('../../modules/order-nexus-test/ModuleEntry.stub.js').descriptor
      })
    }
  ];
});
