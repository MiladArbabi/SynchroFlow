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
        '<rootDir>/tests/**/*.test.ts',
      ],
      transform: {
        '^.+\\.ts$': 'babel-jest',
      },
      moduleNameMapper: {
        '^api-src/(.*)$': '<rootDir>/apps/backend/src/$1',
        '^api-db$': '<rootDir>/apps/backend/src/db.ts',
        '^api-types$': '<rootDir>/apps/backend/src/types.ts',
        '^api-server$': '<rootDir>/apps/backend/src/server.ts',
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
        '^test-utils$': '<rootDir>/apps/frontend/src/test-utils.tsx',
        
        // Add aliases for 'layout' and 'api'
        '^layout/(.*)$': '<rootDir>/apps/frontend/src/layout/$1',
        '^api/(.*)$': '<rootDir>/apps/frontend/src/api/$1',
        '^pages/(.*)$': '<rootDir>/apps/frontend/src/pages/$1',

        '^(components|contexts|layouts|pages|utils|hooks|assets|ui-component|widgets|themes)/(.*)$'
        : '<rootDir>/apps/frontend/src/$1/$2',                
        
        '^config$': '<rootDir>/apps/frontend/src/config.ts',
        '^menu-items$': '<rootDir>/apps/frontend/src/menu-items/index.ts',
        
        // Aliases for root files
        '^(App|Layout|LoginPage|routes)$'
        : '<rootDir>/apps/frontend/src/$1.tsx',
      },
    },
  ],
};