// jest.config.js
//
// TEST-INFRA-FOUNDATION Slice 1A — explicit transitional Jest ownership.
//
// backend-legacy      : every remaining tests/**/*.test.ts(x) not claimed below
//                        (deliberately NOT split into DB-free vs real-DB yet —
//                        tests/unit/backend mixes both).
// backend-integration : tests/integration/**/*.test.ts(x)
// contract            : tests/contract/**/*.test.ts(x)
// frontend            : tests/unit/ui/**/*.test.ts(x), tests/unit/frontend/**/*.test.ts(x)
//
// Runtime/setup semantics (transform, moduleNameMapper, environments,
// globalTeardown) are unchanged in this slice. Slice 1B split the single
// shared root jest.setup.js into tests/setup/jest.node.js (backend-legacy,
// backend-integration, contract) and tests/setup/jest.ui.js (frontend), both
// loading tests/setup/jest.shared.js — testMatch/testEnvironment/transform/
// moduleNameMapper/globalTeardown are otherwise unchanged. api-ui is retired:
// it targeted tests/unit/api/**, which does not exist.
const NODE_TRANSFORM = {
  // handle TS/TSX and JS/JSX in backend tests since some tests import frontend TSX files
  '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
};

const NODE_TRANSFORM_IGNORE_PATTERNS = [
  // allow Jest to transform certain ESM packages that ship modern syntax
  '/node_modules/(?!(react-github-btn|react-resizable-panels|lodash-es|@mui/x-data-grid|uuid|resend|postal-mime|expo-server-sdk))',
  '\\.pnp\\.[^\\/]+$'
];

const NODE_MODULE_FILE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'json'];

const NODE_MODULE_NAME_MAPPER = {
  '^api-src/(.*)$': '<rootDir>/apps/backend/src/$1',
  '^api-db$': '<rootDir>/apps/backend/src/db.ts',
  '^api-types$': '<rootDir>/apps/backend/src/types.ts',
  '^api-server$': '<rootDir>/apps/backend/src/server.ts',

  '^activation/(.*)$': '<rootDir>/apps/frontend/src/activation/$1',

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
  '^wiring/(.*)$': '<rootDir>/apps/frontend/src/wiring/$1',
  '^layout/(.*)$': '<rootDir>/apps/frontend/src/layout/$1',
  '^api/(.*)$': '<rootDir>/apps/frontend/src/api/$1',
  '^expo-server-sdk$': '<rootDir>/tests/__mocks__/expo-server-sdk.ts',

   // Static assets + css (important for node_modules CSS like @mui/x-data-grid)
  '\\.(css|less|scss|sass)$': 'jest-transform-stub',
  '\\.(svg|png|jpg|jpeg|gif)$': '<rootDir>/jest.file-mock.js',

  // integration-service source alias
  '^integration-src/(.*)$': '<rootDir>/apps/integration-service/src/$1',
  /**
   * ESM .js extension resolver (CRITICAL for Jest + TypeScript)
   * -----------------------------------------------------------
   * TypeScript ESM source imports use .js extensions at compile time.
   * Jest resolves from source (.ts) — strip .js so it finds the TS file.
   */
  '^(api-src/.*?)(?<!\\\\.c)\\.js$': '$1',
  '^(\\.{1,2}/.*?)(?<!\\\\.c)\\.js$': '$1',

  // Shared modules alias (so imports like '@lasyncro/shared/...' resolve in tests)
  '^@lasyncro/shared/(.*)$': '<rootDir>/modules/shared/src/$1',
  '^@lasyncro/shared$': '<rootDir>/modules/shared/src',
  // Shared commercial-policy package — one physical source of truth (COMMERCIAL-ACCESS-ARCH-01 P0-A0)
  '^@lasyncro/commercial-policy$': '<rootDir>/packages/commercial-policy/src/index.ts',
  '^@lasyncro/order-nexus$': '<rootDir>/modules/order-nexus/src/ui/index.ts',
  '^@lasyncro/specter$': '<rootDir>/modules/specter/src/ui/index.ts',
  '^@lasyncro/products$': '<rootDir>/modules/products/src/ui/index.ts',
  '^@lasyncro/finances$': '<rootDir>/modules/finances/src/ui',

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
  '^expo-server-sdk$': '<rootDir>/tests/__mocks__/expo-server-sdk.ts',
};

module.exports = {
  globalTeardown: "<rootDir>/jest.global-teardown.js",
  projects: [
    // Owns every remaining Jest .test.ts/.test.tsx candidate not explicitly
    // claimed by backend-integration, contract, or frontend below.
    // NOTE: intentionally NOT split into a DB-free "backend-unit" yet —
    // tests/unit/backend mixes pure and real-DB tests (TEST-INFRA-FOUNDATION
    // Round 1/2 audits).
    {
      displayName: 'backend-legacy',
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/tests/setup/jest.node.js'],
      testMatch: [
        '<rootDir>/tests/**/*.test.ts',
        '<rootDir>/tests/**/*.test.tsx'
      ],
      testPathIgnorePatterns: [
        '/node_modules/',
        '<rootDir>/tests/integration/',
        '<rootDir>/tests/contract/',
        '<rootDir>/tests/unit/ui/',
        '<rootDir>/tests/unit/frontend/'
      ],
      transform: NODE_TRANSFORM,
      transformIgnorePatterns: NODE_TRANSFORM_IGNORE_PATTERNS,
      moduleFileExtensions: NODE_MODULE_FILE_EXTENSIONS,
      moduleNameMapper: NODE_MODULE_NAME_MAPPER,
    },
    // Real Express app + real Postgres integration tests.
    {
      displayName: 'backend-integration',
      // PROJECTION-CURSOR-STALL-08 Slice 3 — fail-closed BEFORE any test file or
      // fixture loads unless PGDATABASE is a disposable synchroflow_test_* DB
      // created by scripts/with-test-db.js (`npm run test:integration`).
      globalSetup: '<rootDir>/tests/setup/backend-integration.global-setup.js',
      testEnvironment: 'node',
      // TEST-DB-ISOLATION-11 Slice 2 — runtime-context disposable-DB guard, in
      // addition to globalSetup (orchestration context). backend-integration only.
      setupFiles: [
        '<rootDir>/tests/setup/jest.node.js',
        '<rootDir>/tests/setup/backend-integration.runtime-db-guard.js',
      ],
      testMatch: [
        '<rootDir>/tests/integration/**/*.test.ts',
        '<rootDir>/tests/integration/**/*.test.tsx'
      ],
      transform: NODE_TRANSFORM,
      transformIgnorePatterns: NODE_TRANSFORM_IGNORE_PATTERNS,
      moduleFileExtensions: NODE_MODULE_FILE_EXTENSIONS,
      moduleNameMapper: NODE_MODULE_NAME_MAPPER,
    },
    // Module contract tests (also run standalone by ci-ui-modules.yml).
    {
      displayName: 'contract',
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/tests/setup/jest.node.js'],
      testMatch: [
        '<rootDir>/tests/contract/**/*.test.ts',
        '<rootDir>/tests/contract/**/*.test.tsx'
      ],
      transform: NODE_TRANSFORM,
      transformIgnorePatterns: NODE_TRANSFORM_IGNORE_PATTERNS,
      moduleFileExtensions: NODE_MODULE_FILE_EXTENSIONS,
      moduleNameMapper: NODE_MODULE_NAME_MAPPER,
    },
    // Configuration for the frontend package
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: [
        '<rootDir>/tests/unit/ui/**/*.test.ts',
        '<rootDir>/tests/unit/ui/**/*.test.tsx',
        '<rootDir>/tests/unit/frontend/**/*.test.ts',
        '<rootDir>/tests/unit/frontend/**/*.test.tsx',
      ],
      transform: {
        '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
      },
      transformIgnorePatterns: [
        '/node_modules/(?!(react-github-btn|react-resizable-panels|lodash-es))',
        '\\.pnp\\.[^\\/]+$'
      ],
      setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.ui.js'],
      moduleNameMapper: {
        '^wiring/(.*)$': '<rootDir>/apps/frontend/src/wiring/$1',

        '\\.(css|less|scss|sass)$': 'jest-transform-stub',
        '\\.(svg|png|jpg|jpeg|gif)$': '<rootDir>/jest.file-mock.js',
        '^test-utils$': '<rootDir>/apps/frontend/src/test-utils.tsx',

        '^virtual:lasyncro-modules$': '<rootDir>/tests/__mocks__/virtual-lasyncro-modules.ts',

        '^activation/(.*)$': '<rootDir>/apps/frontend/src/activation/$1',
        '^lifecycle/(.*)$': '<rootDir>/apps/frontend/src/lifecycle/$1',

        // Add aliases for 'layout' and 'api'
        '^layout/(.*)$': '<rootDir>/apps/frontend/src/layout/$1',
        '^api/(.*)$': '<rootDir>/apps/frontend/src/api/$1',
        '^pages/(.*)$': '<rootDir>/apps/frontend/src/pages/$1',

        '^runtime/(.*)$': '<rootDir>/apps/frontend/src/runtime/$1',
        '^runtime$': '<rootDir>/apps/frontend/src/runtime/index.ts',

        '^@lasyncro/shared/ui$': '<rootDir>/modules/shared/src/ui',
        // Shared commercial-policy package — same physical source as the node projects (P0-A0)
        '^@lasyncro/commercial-policy$': '<rootDir>/packages/commercial-policy/src/index.ts',
        '^@lasyncro/order-nexus$': '<rootDir>/modules/order-nexus/src/ui/index.ts',
        '^@lasyncro/specter$': '<rootDir>/modules/specter/src/ui/index.ts',
        '^@lasyncro/products$': '<rootDir>/modules/products/src/ui/index.ts',
        '^@lasyncro/finances$': '<rootDir>/modules/finances/src/ui',

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
