//tests/unit/backend/auth/user-email-uniqueness.test.ts
import db from 'api-db';

describe('DB invariant: users.email must be unique', () => {
  beforeEach(async () => {
    // Clean only what this test touches
    await db('users').del();
    await db('shops').del();
  });

  it('rejects duplicate users with the same email at DB level', async () => {
    // Arrange: required shop
    await db('shops').insert({
      id: 1,
      name: 'Test Shop',
      contact_email: 'shop@test.com',
      auth_secret: 'secret',
      primary_erp_type: 'NONE',
      primary_ecomm_type: 'SHOPIFY',
    });

    const email = 'duplicate@test.com';

    // First insert — should succeed
    await db('users').insert({
      id: 1,
      shop_id: 1,
      email,
      password_hash: 'hash-1',
    });

    let error: any = null;

    // Second insert with same email — must fail
    try {
      await db('users').insert({
        id: 2,
        shop_id: 1,
        email,
        password_hash: 'hash-2',
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeTruthy();

    // Postgres unique violation error code
    expect(error.code).toBe('23505');
  });
});
