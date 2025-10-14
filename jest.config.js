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
      // Use babel-jest for all backend files
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
      // Use babel-jest for all frontend files
      transform: {
        '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
      },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'jest-transform-stub',
        '\\.(svg|png|jpg|jpeg|gif)$': '<rootDir>/jest.file-mock.js',
        '^assets/(.*)$': '<rootDir>/packages/ui/src/assets/$1',
        '^components/(.*)$': '<rootDir>/packages/ui/src/components/$1',
        '^context$': '<rootDir>/packages/ui/src/contexts/MaterialUI.tsx',
        '^examples/(.*)$': '<rootDir>/packages/ui/src/components/$1',
        '^layouts/(.*)$': '<rootDir>/packages/ui/src/layouts/$1',
      },
    },
  ],
};