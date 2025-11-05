// jest.setup.js
import '@testing-library/jest-dom';

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

// Mock Vite's import.meta.env
Object.defineProperty(global, 'import.meta', {
  value: {
    env: {
      VITE_APP_VERSION: 'test-version', // Provide a mock version
      // Add other env variables used by your app here
    }
  },
  writable: true 
});

jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('recharts', () => {
    const OriginalModule = jest.requireActual('recharts');
    return {
        ...OriginalModule,
        ResponsiveContainer: ({ children }) => children,
    };
});