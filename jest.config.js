module.exports = {
  // Use Jest's 'projects' configuration for monorepos
  projects: [
    // Configuration for backend packages (api, cpp-core)
    {
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/packages/api/**/*.test.ts', '<rootDir>/packages/cpp-core/**/*.test.ts'],
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
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'jest-transform-stub',
      },
    },
  ],
};