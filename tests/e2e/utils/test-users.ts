// tests/e2e/utils/test-users.ts
// This file centralizes all test user credentials.
// It assumes these users exist in your seed data.

export const TEST_USERS = {
  'default-user': {
    email: 'test@example.com',
    password: 'password123',
  },
  // In the future, we can add other user types here
  // 'admin-user': {
  //   email: 'admin@example.com',
  //   password: 'password123',
  // },
  // 'no-perms-user': {
  //   email: 'noperms@example.com',
  //   password: 'password123',
  // }
};

export type TestUserKey = keyof typeof TEST_USERS;