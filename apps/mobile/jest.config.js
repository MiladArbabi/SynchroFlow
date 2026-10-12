const expoPreset = require('jest-expo/jest-preset');

module.exports = {
  preset: 'jest-expo',
  rootDir: __dirname,
  displayName: 'mobile',
  watchman: false,
  testMatch: [
    '<rootDir>/__tests__/**/*.test.ts',
    '<rootDir>/__tests__/**/*.test.tsx',
  ],
  // Test-only Expo transform: the root web Babel config cannot parse RN Flow.
  transform: {
    ...expoPreset.transform,
    '\\.[jt]sx?$': [require.resolve('babel-jest'), {
      babelrc: false,
      configFile: false,
      presets: [require.resolve('babel-preset-expo')],
      caller: { name: 'metro', bundler: 'metro', platform: 'ios' },
    }],
  },
  moduleNameMapper: {
    '^@lasyncro/mobile-core$': '<rootDir>/../../packages/mobile-core/src/index.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup/jest.mobile.js'],
};
