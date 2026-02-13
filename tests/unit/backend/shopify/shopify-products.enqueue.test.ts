// tests/unit/backend/shopify/shopify-products.enqueue.test.ts

import * as productWorker from 'api-src/workers/product-worker';
import { performInitialSync } from 'api-src/services/shopify.service';
import db from 'api-db';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedIntegration } from '../../helpers/seedIntegration';

jest.mock('api-src/workers/product-worker');

jest.mock('@shopify/shopify-api', () => {
  return {
    shopifyApi: () => ({
      clients: {
        Graphql: jest.fn().mockImplementation(() => ({
          request: jest.fn().mockResolvedValue({
            data: {
              products: {
                edges: [
                  {
                    node: {
                      id: 'gid://shopify/Product/1',
                      title: 'Test Product',
                      status: 'active',
                      variants: [],
                    },
                  },
                ],
              },
              orders: { edges: [] },
              shop: { id: '1', name: 'Test Shop' },
            },
          }),
        })),
      },
    }),
    ApiVersion: { January24: '2024-01' },
    Session: jest.fn(),
  };
});


describe('Shopify product ingestion enqueue', () => {
  const shopId = 101;
  const userId = 201;

  beforeEach(async () => {
    await db('products').del();
    await db('integrations').del();
    await db('users').del();
    await db('shops').del();

    await seedShopAndUser({ shopId, userId });
    await seedIntegration({ shopId });
  });

  it('enqueues each Shopify product for canonical ingestion', async () => {
    const spy = jest
      .spyOn(productWorker, 'processProductMessage')
      .mockResolvedValue();

    await performInitialSync(
      'test-token',
      'test-shop.myshopify.com',
      shopId,
      1
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
    shopId,
    platform: 'shopify',
        rawProduct: expect.objectContaining({
            id: 'gid://shopify/Product/1',
        }),
    });
  });
});