// tests/unit/backend/customers/customersFacts.service.test.ts
import db from 'api-db';
import { getCustomersFacts } from 'api-src/services/customers-facts/customersFacts.service';

describe('CustomersFacts.service (FT2)', () => {
  const shopId = 1;

  beforeEach(async () => {
    await db('shops').insert({
      id: shopId,
      name: 'Test Shop',
      contact_email: 'test@shop.com',
      auth_secret: 'test-secret',
      primary_erp_type: 'none',
      primary_ecomm_type: 'shopify'
    });
  });

  afterEach(async () => {
    await db('customers').del();
    await db('shops').del();
  });

  it('returns null when no customers exist', async () => {
    const facts = await getCustomersFacts({
      shopId,
      period: {
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-07T23:59:59.999Z'
      }
    });

    expect(facts.customersObserved).toBeNull();
  });

  it('counts customers created inside the period', async () => {
    await db('customers').insert([
      {
        shop_id: shopId,
        platform_customer_id: 'c1',
        email: 'a@test.com',
        created_at: '2024-01-03T10:00:00.000Z'
      },
      {
        shop_id: shopId,
        platform_customer_id: 'c2',
        email: 'b@test.com',
        created_at: '2024-01-05T10:00:00.000Z'
      }
    ]);

    const facts = await getCustomersFacts({
      shopId,
      period: {
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-07T23:59:59.999Z'
      }
    });

    expect(facts.customersObserved).toBe(2);
  });

  it('excludes customers outside the period', async () => {
    await db('customers').insert([
      {
        shop_id: shopId,
        platform_customer_id: 'old',
        email: 'old@test.com',
        created_at: '2023-12-01T10:00:00.000Z'
      },
      {
        shop_id: shopId,
        platform_customer_id: 'new',
        email: 'new@test.com',
        created_at: '2024-01-03T10:00:00.000Z'
      }
    ]);

    const facts = await getCustomersFacts({
      shopId,
      period: {
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-07T23:59:59.999Z'
      }
    });

    expect(facts.customersObserved).toBe(1);
  });

  it('returns null when customers exist but none fall in the period', async () => {
    await db('customers').insert([
      {
        shop_id: shopId,
        platform_customer_id: 'x',
        email: 'x@test.com',
        created_at: '2023-12-01T10:00:00.000Z'
      }
    ]);

    const facts = await getCustomersFacts({
      shopId,
      period: {
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-07T23:59:59.999Z'
      }
    });

    expect(facts.customersObserved).toBeNull();
  });

  it('isolates customers by shopId', async () => {
  await db('shops').insert({
    id: 9999,
    name: 'Other Shop',
    contact_email: 'other@shop.com',
    auth_secret: 'other-secret',
    primary_erp_type: 'none',
    primary_ecomm_type: 'shopify'
  });

  await db('customers').insert([
    {
      shop_id: shopId,
      platform_customer_id: 'a',
      email: 'a@test.com',
      created_at: '2024-01-03T10:00:00.000Z'
    },
    {
      shop_id: 9999,
      platform_customer_id: 'b',
      email: 'b@test.com',
      created_at: '2024-01-03T10:00:00.000Z'
    }
  ]);

  const facts = await getCustomersFacts({
    shopId,
    period: {
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-01-07T23:59:59.999Z'
    }
  });

  expect(facts.customersObserved).toBe(1);
});
});