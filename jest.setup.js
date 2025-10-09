// jest.setup.js
require('@testing-library/jest-dom');

// Polyfill for TextEncoder/TextDecoder which are not available in JSDOM
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.ResizeObserver = require('resize-observer-polyfill');

jest.mock('recharts', () => {
    const OriginalModule = jest.requireActual('recharts');
    return {
        ...OriginalModule,
        ResponsiveContainer: ({ children }) => children,
    };
});