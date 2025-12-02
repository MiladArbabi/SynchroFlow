// tests/unit/integration/shopify-trial-sync-canonical.test.ts

/**
 * Goal (RED):
 * - When /integrations/shopify/start-trial-sync is called,
 *   the integration-service MUST map each Shopify order
 *   to CanonicalOrder via mapShopifyOrderToCanonical before staging.
 *
 * This test intentionally fails right now, because server.ts
 * does not call the canonical mapper yet.
 */

import app from 'integration-src/server';

// ---- Mocks ----

// 1) Shopify client – we control what orders come back
jest.mock('integration-src/clients/shopify', () => {
  const fetchRecentOrders = jest.fn();
  return {
    __esModule: true,
    fetchRecentOrders,
  };
});

// Get a handle to the mock instance AFTER jest.mock, using require
const { fetchRecentOrders: fetchRecentOrdersMock } =
  require('integration-src/clients/shopify') as {
    fetchRecentOrders: jest.Mock;
  };

// 2) Queue publisher – we don't care about its behavior here
jest.mock('integration-src/queue', () => {
  const publishToQueue = jest.fn().mockResolvedValue(undefined);
  return {
    __esModule: true,
    publishToQueue,
  };
});

const { publishToQueue: publishToQueueMock } =
  require('integration-src/queue') as {
    publishToQueue: jest.Mock;
  };

// 3) DB – minimal knex-like interface for insert().returning()
jest.mock('integration-src/db', () => {
  const mockDbInstance = {
    insert: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: 1 }]),
  };

  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };

  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn,
    mockDbInstance,
  };
});

// After mocks, get a handle to the db instance
const { mockDbInstance } = require('integration-src/db') as {
  mockDbInstance: {
    insert: jest.Mock;
    returning: jest.Mock;
  };
};

// 4) Canonical mapper – we only assert that it gets called
jest.mock('integration-src/mappers/canonical-commerce-mapper', () => {
  const mapShopifyOrderToCanonical = jest.fn();
  const mapShopifyProductToCanonical = jest.fn();

  return {
    __esModule: true,
    mapShopifyOrderToCanonical,
    mapShopifyProductToCanonical,
  };
});

const {
  mapShopifyOrderToCanonical: mapShopifyOrderToCanonicalMock,
  mapShopifyProductToCanonical: mapShopifyProductToCanonicalMock,
} = require('integration-src/mappers/canonical-commerce-mapper') as {
  mapShopifyOrderToCanonical: jest.Mock;
  mapShopifyProductToCanonical: jest.Mock;
};

// ---- Helper to get the specific route handler without supertest ----

function getStartTrialSyncHandler() {
  const anyApp: any = app;
  const layer = anyApp._router.stack.find(
    (l: any) =>
      l.route &&
      l.route.path === '/integrations/shopify/start-trial-sync' &&
      l.route.methods.post
  );

  if (!layer) {
    throw new Error(
      'Could not find /integrations/shopify/start-trial-sync POST route on app router'
    );
  }

  // The route has multiple layers (e.g. express.json, then the real handler).
  // We want the LAST one, which is our async business handler.
  const routeStack = layer.route.stack;
  const actualLayer = routeStack[routeStack.length - 1];

  return actualLayer.handle;
}

describe('integration-service - /integrations/shopify/start-trial-sync canonicalization', () => {
  const rawOrder = {
    id: 123456789,
    shop_id: 42,
    total_price: '100.00',
    subtotal_price: '100.00',
    total_tax: '0.00',
    currency: 'USD',
  };

  const canonicalOrder = {
    id: 'order-123',
    shopId: 42,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    currency: 'USD',
    totalPrice: 100,
    subtotalPrice: 100,
    totalTax: 0,
    shippingLines: [],
    lineItems: [],
    source: null,
    referrerMedium: null,
    platform: 'shopify',
    platformOrderId: 'order-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fetchRecentOrdersMock.mockReset();
    fetchRecentOrdersMock.mockResolvedValue([rawOrder]);

    // Each call to the canonical mapper returns our canonicalOrder
    mapShopifyOrderToCanonicalMock.mockReset();
    mapShopifyOrderToCanonicalMock.mockReturnValue(canonicalOrder);
  });

  it('should map each Shopify order to CanonicalOrder during trial sync (RED)', async () => {
    const handler = getStartTrialSyncHandler();

    const req: any = {
      body: {
        shopId: 42,
        shop: 'test-shop.myshopify.com',
        accessToken: 'test-access-token',
      },
    };

    const jsonMock = jest.fn();
    const statusMock = jest.fn(() => ({ json: jsonMock }));

    const res: any = {
      status: statusMock,
    };

    // Act
    await handler(req, res);

    // Assert: verify Shopify client was called correctly
    expect(fetchRecentOrdersMock).toHaveBeenCalledWith(
      'test-shop.myshopify.com',
      'test-access-token'
    );

    // 🔴 RED EXPECTATION:
    // We expect the canonical mapper to be called once per order.
    // This currently FAILS because server.ts does not use the mapper yet.
    expect(mapShopifyOrderToCanonicalMock).toHaveBeenCalledTimes(1);
    expect(mapShopifyOrderToCanonicalMock).toHaveBeenCalledWith(
      rawOrder,
      expect.objectContaining({
        hashCustomerId: expect.any(Function),
      })
    );

    // NEW: verify that the staged event uses the canonical payload,
    // not the raw Shopify order.
    expect(mockDbInstance.insert).toHaveBeenCalledTimes(1);
    expect(mockDbInstance.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        shop_id: 42,
        source_platform: 'shopify',
        event_type: 'orders/create',
        raw_payload: canonicalOrder,
      })
    );

    // Sanity: response should still be a 202 with a message
    expect(statusMock).toHaveBeenCalledWith(202);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Scoped trial sync initiated'),
      })
    );
  });
});
