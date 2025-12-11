// jest.config.js
module.exports = {
  globalTeardown: "<rootDir>/jest.global-teardown.js",
  projects: [
    // Configuration for ALL backend packages
    {
      displayName: 'backend',
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/jest.setup.js'],
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

        // integration-service source alias
        '^integration-src/(.*)$': '<rootDir>/apps/integration-service/src/$1',

        // Shared modules alias (so imports like '@lasyncro/shared/...' resolve in tests)
        '^@lasyncro/shared/(.*)$': '<rootDir>/modules/shared/src/$1',
        '^@lasyncro/shared$': '<rootDir>/modules/shared/src',
        '^shared-src$': '<rootDir>/modules/shared/src',

        // Specter module alias (resolve imports like 'modules-specter/...'
        // to the source files so tests don't require brittle relative paths)
        '^modules-specter/(.*)$': '<rootDir>/modules/specter/src/$1',
        '^modules-specter$': '<rootDir>/modules/specter/src/index.ts',

        '^routes$': '<rootDir>/apps/frontend/src/routes.tsx',
        '^utils/(.*)$': '<rootDir>/apps/frontend/src/utils/$1',
        '^components/(.*)$': '<rootDir>/apps/frontend/src/components/$1',
        '^contexts/(.*)$': '<rootDir>/apps/frontend/src/contexts/$1',
        '^ui-component/(.*)$': '<rootDir>/apps/frontend/src/ui-component/$1',

        '^runtime/(.*)$': '<rootDir>/apps/frontend/src/runtime/$1',
        '^runtime$': '<rootDir>/apps/frontend/src/runtime/index.ts',
      },
    },
    /* paste this object into the `projects` array in jest.config.js */
    {
      displayName: 'api-ui',
      testEnvironment: 'jsdom',
      testMatch: [
        '<rootDir>/tests/unit/api/**/*.test.ts',
        '<rootDir>/tests/unit/api/**/*.test.tsx'
      ],
      transform: {
        '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest'
      },
      transformIgnorePatterns: [
        '/node_modules/(?!(react-github-btn|react-resizable-panels|lodash-es))',
        '\\.pnp\\.[^\\/]+$'
      ],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: {
        '^ui/src/(.*)$': '<rootDir>/apps/frontend/src/$1',
        '^components/(.*)$': '<rootDir>/apps/frontend/src/components/$1',
        '^contexts/(.*)$': '<rootDir>/apps/frontend/src/contexts/$1',
        '^runtime/(.*)$': '<rootDir>/apps/frontend/src/runtime/$1',
        '^hooks/(.*)$': '<rootDir>/apps/frontend/src/hooks/$1',
        '^ui-component/(.*)$': '<rootDir>/apps/frontend/src/ui-component/$1',
        '^pages/(.*)$': '<rootDir>/apps/frontend/src/pages/$1',
        '^layout/(.*)$': '<rootDir>/apps/frontend/src/layout/$1',
        '^api/(.*)$': '<rootDir>/apps/frontend/src/api/$1',
        '^themes/(.*)$': '<rootDir>/apps/frontend/src/themes/$1',
        '^routes$': '<rootDir>/apps/frontend/src/routes.tsx',
        '^config$': '<rootDir>/apps/frontend/src/config.ts',
        '^test-utils$': '<rootDir>/apps/frontend/src/test-utils.tsx',

        // New / missing mappings:
        '^utils/(.*)$': '<rootDir>/apps/frontend/src/utils/$1',
        '^ui-component/(.*)$': '<rootDir>/apps/frontend/src/ui-component/$1',
        // assets + css
        '\\.(css|less|scss|sass)$': 'jest-transform-stub',
        '\\.(svg|png|jpg|jpeg|gif)$': '<rootDir>/jest.file-mock.js'
      },
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json']
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