// jest.config.js
module.exports = {
  projects: [
    // Configuration for ALL backend packages
    {
      displayName: 'backend',
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/jest.env.js'],
      testMatch: [
        '<rootDir>/packages/api/**/*.test.ts',
        '<rootDir>/packages/cpp-core/**/*.test.ts',
        '<rootDir>/packages/integration-service/**/*.test.ts',
      ],
      // Explicitly use babel-jest for all .ts files
      transform: {
        '^.+\\.ts$': 'babel-jest',
      },
    },
    // Configuration for the frontend package
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: [
        '<rootDir>/packages/ui/src/**/*.test.tsx',
        '<rootDir>/packages/ui/__tests__/**/*.test.tsx',
      ],
      // Explicitly use babel-jest for all .tsx and .ts files
      transform: {
        '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
      },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'jest-transform-stub',
        '^assets/(.*)$': '<rootDir>/packages/ui/src/assets/$1',
      },
    },
  ],
};