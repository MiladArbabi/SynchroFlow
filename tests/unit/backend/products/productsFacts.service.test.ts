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

  test('returns raw counts from canonical_products (no interpretation)', async () => {
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
      period: { from: '2020-01-01', to: '2030-01-01' }, // must be ignored
    });

    expect(facts.productsObserved).toBe(3);
    expect(facts.skusObserved).toBe(0);

    expect(facts.statusCounts).toEqual({
      active: 1,
      inactive: 1,
      archived: 1,
    });
  });

  test('ignores period filtering entirely (counts all rows regardless of dates)', async () => {
    await seedCanonicalProduct({
      shopId: SHOP_ID,
      platformProductId: 'prod-a',
    });

    await seedCanonicalProduct({
      shopId: SHOP_ID,
      platformProductId: 'prod-b',
    });

    const facts = await getProductsFacts({
      shopId: SHOP_ID,
      period: { from: '1990-01-01', to: '1990-12-31' }, // intentionally irrelevant
    });

    expect(facts.productsObserved).toBe(2);
  });

  test('counts distinct non-null SKUs only', async () => {
    await db('canonical_products').insert([
      {
        shop_id: SHOP_ID,
        platform: 'shopify',
        platform_product_id: 'p1',
        sku: 'SKU-1',
        title: 'A',
        status: 'active',
      },
      {
        shop_id: SHOP_ID,
        platform: 'shopify',
        platform_product_id: 'p2',
        sku: 'SKU-1',
        title: 'B',
        status: 'active',
      },
      {
        shop_id: SHOP_ID,
        platform: 'shopify',
        platform_product_id: 'p3',
        sku: null,
        title: 'C',
        status: 'active',
      },
    ]);

    const facts = await getProductsFacts({
      shopId: SHOP_ID,
      period: { from: '2000-01-01', to: '2100-01-01' },
    });

    expect(facts.productsObserved).toBe(3);
    expect(facts.skusObserved).toBe(1);
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

  test('does not derive or emit non-factual or semantic fields', async () => {
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
    expect((facts as any).reason).toBeUndefined();
  });

  test('is isolated strictly to canonical_products (no other tables involved)', async () => {
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
    expect(facts.statusCounts.inactive).toBe(0);
    expect(facts.statusCounts.archived).toBe(0);
  });
});