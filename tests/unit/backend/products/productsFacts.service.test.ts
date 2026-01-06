import db from 'api-db';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedCanonicalProduct } from '../../helpers/seedCanonicalProduct';
import { getProductsFacts } from 'api-src/services/products-facts/ProductsFacts.service';

describe('ProductsFacts.service (Layer 1)', () => {
  const SHOP_ID = 1001;
  const USER_ID = 2001;

  beforeEach(async () => {
    await seedShopAndUser({ shopId: SHOP_ID, userId: USER_ID });
  });

  afterEach(async () => {
    await db('canonical_products').del();
    await db('users').del();
    await db('shops').del();
  });

  test('returns raw counts from canonical_products', async () => {
    // active (default)
    await seedCanonicalProduct({
      shopId: SHOP_ID,
      platformProductId: 'prod-1',
    });

    // inactive
    await seedCanonicalProduct({
      shopId: SHOP_ID,
      platformProductId: 'prod-2',
    });
    await db('canonical_products')
      .where({ shop_id: SHOP_ID, platform_product_id: 'prod-2' })
      .update({ status: 'inactive' });

    // archived
    await seedCanonicalProduct({
      shopId: SHOP_ID,
      platformProductId: 'prod-3',
    });
    await db('canonical_products')
      .where({ shop_id: SHOP_ID, platform_product_id: 'prod-3' })
      .update({ status: 'archived' });

    const facts = await getProductsFacts({
      shopId: SHOP_ID,
      period: { from: '2020-01-01', to: '2030-01-01' },
    });

    expect(facts.productsObserved).toBe(3);
    expect(facts.skusObserved).toBe(0);

    expect(facts.statusCounts).toEqual({
      active: 1,
      inactive: 1,
      archived: 1,
    });
  });

  test('preserves nulls when no canonical products exist', async () => {
    const facts = await getProductsFacts({
      shopId: SHOP_ID,
      period: { from: '2020-01-01', to: '2030-01-01' },
    });

    expect(facts.productsObserved).toBeNull();
    expect(facts.skusObserved).toBeNull();
    expect(facts.statusCounts).toEqual({
      active: null,
      inactive: null,
      archived: null,
    });
  });

  test('does not derive or emit non-factual fields', async () => {
    await seedCanonicalProduct({
      shopId: SHOP_ID,
      platformProductId: 'prod-x',
    });

    const facts = await getProductsFacts({
      shopId: SHOP_ID,
      period: { from: '2020-01-01', to: '2030-01-01' },
    });

    expect((facts as any).health).toBeUndefined();
    expect((facts as any).trend).toBeUndefined();
    expect((facts as any).coverage).toBeUndefined();
    expect((facts as any).outcome).toBeUndefined();
    expect((facts as any).recommendation).toBeUndefined();
  });

  test('is isolated to canonical product truth', async () => {
    // No data seeded in any other product-related tables.
    // If this service touched them, results would differ.

    await seedCanonicalProduct({
      shopId: SHOP_ID,
      platformProductId: 'prod-only',
    });

    const facts = await getProductsFacts({
      shopId: SHOP_ID,
      period: { from: '2020-01-01', to: '2030-01-01' },
    });

    expect(facts.productsObserved).toBe(1);
    expect(facts.statusCounts.active).toBe(1);
  });
});