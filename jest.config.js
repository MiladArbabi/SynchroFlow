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
        '<rootDir>/tests/unit/backend/**/*.test.ts'
      ],
      transform: {
        // handle TS/TSX and JS/JSX in backend tests since some tests import frontend TSX files
        '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
      },
      transformIgnorePatterns: [
        // allow Jest to transform certain ESM packages that ship modern syntax
        '/node_modules/(?!(react-github-btn|react-resizable-panels|lodash-es|@mui/x-data-grid))',
        '\\.pnp\\.[^\\/]+$'
      ],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
      moduleNameMapper: {
        '^api-src/(.*)$': '<rootDir>/apps/backend/src/$1',
        '^api-db$': '<rootDir>/apps/backend/src/db.ts',
        '^api-types$': '<rootDir>/apps/backend/src/types.ts',
        '^api-server$': '<rootDir>/apps/backend/src/server.ts',

        '^virtual:lasyncro-modules$': '<rootDir>/tests/__mocks__/virtual-lasyncro-modules.ts',

        // FRONTEND ALIASES (so backend tests can import frontend files safely)
        '^routes$': '<rootDir>/apps/frontend/src/routes.tsx',
        '^config$': '<rootDir>/apps/frontend/src/config.ts',
        '^hooks/(.*)$': '<rootDir>/apps/frontend/src/hooks/$1',
        '^utils/(.*)$': '<rootDir>/apps/frontend/src/utils/$1',
        '^components/(.*)$': '<rootDir>/apps/frontend/src/components/$1',
        '^contexts/(.*)$': '<rootDir>/apps/frontend/src/contexts/$1',
        '^ui-component/(.*)$': '<rootDir>/apps/frontend/src/ui-component/$1',
        '^pages/(.*)$': '<rootDir>/apps/frontend/src/pages/$1',
        '^layout/(.*)$': '<rootDir>/apps/frontend/src/layout/$1',
        '^api/(.*)$': '<rootDir>/apps/frontend/src/api/$1',

         // Static assets + css (important for node_modules CSS like @mui/x-data-grid)
        '\\.(css|less|scss|sass)$': 'jest-transform-stub',
        '\\.(svg|png|jpg|jpeg|gif)$': '<rootDir>/jest.file-mock.js',

        // integration-service source alias
        '^integration-src/(.*)$': '<rootDir>/apps/integration-service/src/$1',

        // Shared modules alias (so imports like '@lasyncro/shared/...' resolve in tests)
        '^@lasyncro/shared/(.*)$': '<rootDir>/modules/shared/src/$1',
        '^@lasyncro/shared$': '<rootDir>/modules/shared/src',
        '^shared-src$': '<rootDir>/modules/shared/src',

        // Specter module alias
        '^modules-specter/(.*)$': '<rootDir>/modules/specter/src/$1',
        '^modules-specter$': '<rootDir>/modules/specter/src/index.ts',

        // Frontend aliases used by tests: map to the frontend source so backend tests can require them
        '^routes$': '<rootDir>/apps/frontend/src/routes.tsx',
        '^utils/(.*)$': '<rootDir>/apps/frontend/src/utils/$1',
        '^components/(.*)$': '<rootDir>/apps/frontend/src/components/$1',
        '^contexts/(.*)$': '<rootDir>/apps/frontend/src/contexts/$1',
        '^ui-component/(.*)$': '<rootDir>/apps/frontend/src/ui-component/$1',
        '^config$': '<rootDir>/apps/frontend/src/config.ts',

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
        '/node_modules/(?!(react-github-btn|react-resizable-panels|lodash-es|@mui/x-data-grid))',
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
        '^@lasyncro/shared/ui$': '<rootDir>/modules/shared/src/ui',

        '^virtual:lasyncro-modules$': '<rootDir>/tests/__mocks__/virtual-lasyncro-modules.ts',

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

        '^virtual:lasyncro-modules$': '<rootDir>/tests/__mocks__/virtual-lasyncro-modules.ts',

        '^activation/(.*)$': '<rootDir>/apps/frontend/src/activation/$1',
        
        // Add aliases for 'layout' and 'api'
        '^layout/(.*)$': '<rootDir>/apps/frontend/src/layout/$1',
        '^api/(.*)$': '<rootDir>/apps/frontend/src/api/$1',
        '^pages/(.*)$': '<rootDir>/apps/frontend/src/pages/$1',

        '^runtime/(.*)$': '<rootDir>/apps/frontend/src/runtime/$1',
        '^runtime$': '<rootDir>/apps/frontend/src/runtime/index.ts',

        '^@lasyncro/shared/ui$': '<rootDir>/modules/shared/src/ui',

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