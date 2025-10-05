module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Tell ts-jest to use the tsconfig.json in api package
        tsconfig: 'packages/api/tsconfig.json',
      },
    ],
  },
};