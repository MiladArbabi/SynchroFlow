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
      moduleNameMapper: {
        // Alias for the src directory
        '^api-src/(.*)$': '<rootDir>/packages/api/src/$1',
        // Direct aliases for common imports
        '^api-db$': '<rootDir>/packages/api/src/db.ts',
        '^api-types$': '<rootDir>/packages/api/src/types.ts',
        '^api-server$': '<rootDir>/packages/api/src/server.ts',
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
        '/node_modules/(?!(react-github-btn|react-resizable-panels|lodash-es))',
        '\\.pnp\\.[^\\/]+$'
      ],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'jest-transform-stub',
        '\\.(svg|png|jpg|jpeg|gif)$': '<rootDir>/jest.file-mock.js',
        '^test-utils$': '<rootDir>/packages/ui/src/test-utils.tsx',
        
        // Add aliases for 'layout' and 'api'
        '^layout/(.*)$': '<rootDir>/packages/ui/src/layout/$1',
        '^api/(.*)$': '<rootDir>/packages/ui/src/api/$1',

        '^(components|contexts|layouts|pages|utils|hooks|assets|ui-component|widgets|themes)/(.*)$': '<rootDir>/packages/ui/src/$1/$2',                
        
        '^config$': '<rootDir>/packages/ui/src/config.ts',
        '^menu-items$': '<rootDir>/packages/ui/src/menu-items/index.ts',
        
        // Aliases for root files
        '^(App|Layout|LoginPage|routes)$': '<rootDir>/packages/ui/src/$1.tsx',
      },
    },
  ],
};