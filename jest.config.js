// jest.config.js
module.exports = {
  globalTeardown: "<rootDir>/jest.global-teardown.js",
  projects: [
    // Configuration for ALL backend packages
    {
      displayName: 'backend',
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/jest.env.js'],
      testMatch: [
        '<rootDir>/tests/unit/api/**/*.test.ts',
        '<rootDir>/tests/unit/core-engine/**/*.test.ts',
        '<rootDir>/tests/unit/integration/**/*.test.ts',
      ],
      transform: {
        '^.+\\.ts$': 'babel-jest',
      },
    },
    // Configuration for the frontend package
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: [
        '<rootDir>/tests/unit/ui/**/*.test.tsx',
      ],
      transform: {
        '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
      },
      transformIgnorePatterns: [
        '/node_modules/(?!react-github-btn)',
        '\\.pnp\\.[^\\/]+$'
      ],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'jest-transform-stub',
        '\\.(svg|png|jpg|jpeg|gif)$': '<rootDir>/jest.file-mock.js',
        '^test-utils$': '<rootDir>/packages/ui/src/test-utils.tsx',
        // Match any import that starts with a folder name inside /src
        '^(components|contexts|pages|utils|hooks|assets)/(.*)$': '<rootDir>/packages/ui/src/$1/$2',
        '^(App|Layout|LoginPage|routes)$': '<rootDir>/packages/ui/src/$1.tsx',
      },
    },
  ],
};