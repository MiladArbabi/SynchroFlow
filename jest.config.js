module.exports = {
  // Use Jest's 'projects' configuration for monorepos
  projects: [
    // Configuration for backend packages (api, cpp-core)
    {
      displayName: 'backend',
      testEnvironment: 'node',
      // This file will run before all backend tests, loading the .env file.
      setupFiles: ['<rootDir>/jest.env.js'],
      testMatch: [
        '<rootDir>/packages/api/**/*.test.ts',
        '<rootDir>/packages/cpp-core/**/*.test.ts',
        '<rootDir>/packages/integration-service/**/*.test.ts'
      ],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'packages/api/tsconfig.json' }],
      },
    },
    // Configuration for the frontend package (ui)
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/packages/ui/src/**/*.test.tsx'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'packages/ui/tsconfig.json' }],
      },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'jest-transform-stub',
      },
    },
  ],
};