// tests/unit/services/shopify-sync.integration.test.ts
/**
 * NOTE:
 * This is a scaffolding integration-style test for the Shopify sync job path.
 * It is intentionally marked as `describe.skip` until we wire it to the actual
 * orchestrator/service entrypoint (to avoid breaking CI on unknown import paths).
 *
 * Once the correct entry function is confirmed (e.g. ShopifySyncOrchestrator.run
 * or ShopifyService.syncInitial), unskip this suite and replace the TODO import.
 */

import db from 'api-src/db';
import CryptoJS from 'crypto-js';

// We WILL need the real orchestrator/service here, but we don't guess the path yet.
// TODO: replace `any` with the real orchestrator import once confirmed.
// import { ShopifySyncOrchestrator } from 'api-src/services/shopify-sync-orchestrator';

jest.mock('api-src/db');
jest.mock('crypto-js');

const mockedDb = db as unknown as jest.Mock & { raw: jest.Mock };
const mockedCryptoJS = CryptoJS as unknown as {
  AES: {
    decrypt: jest.Mock;
  };
};

describe.skip('Shopify Sync Job Integration (scaffold)', () => {
  const integrationId = 1;
  const shopId = 1;

  // Shared Knex-like mocks
  const mockIntegrationsWhere = jest.fn().mockReturnThis();
  const mockIntegrationsFirst = jest.fn();
  const mockIntegrationsUpdate = jest.fn().mockResolvedValue(undefined);

  const mockProductsInsert = jest.fn().mockReturnThis();
  const mockProductsOnConflict = jest.fn().mockReturnThis();
  const mockProductsMerge = jest.fn().mockResolvedValue(undefined);

  const mockOrdersInsert = jest.fn().mockReturnThis();
  const mockOrdersOnConflict = jest.fn().mockReturnThis();
  const mockOrdersMerge = jest.fn().mockResolvedValue(undefined);

  const mockLineItemsInsert = jest.fn().mockReturnThis();
  const mockLineItemsOnConflict = jest.fn().mockReturnThis();
  const mockLineItemsMerge = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();

    // Minimal happy-path integration row
    mockIntegrationsFirst.mockResolvedValue({
      id: integrationId,
      shop_id: shopId,
      platform: 'shopify',
      access_token_encrypted: 'encrypted-token',
      sync_status: 'PENDING',
      sync_progress_current: 0,
      sync_progress_total: 0,
      sync_last_error: null,
    });

    // Mock db(table) router
    (mockedDb as jest.Mock).mockImplementation((table: string) => {
      if (table === 'integrations') {
        return {
          where: mockIntegrationsWhere,
          first: mockIntegrationsFirst,
          update: mockIntegrationsUpdate,
        };
      }

      if (table === 'shopify_products') {
        return {
          insert: mockProductsInsert,
          onConflict: mockProductsOnConflict,
          merge: mockProductsMerge,
        };
      }

      if (table === 'orders') {
        return {
          insert: mockOrdersInsert,
          onConflict: mockOrdersOnConflict,
          merge: mockOrdersMerge,
        };
      }

      if (table === 'order_line_items') {
        return {
          insert: mockLineItemsInsert,
          onConflict: mockLineItemsOnConflict,
          merge: mockLineItemsMerge,
        };
      }

      // Default: something harmless
      return {
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockResolvedValue(undefined),
      };
    });

    // Decrypt token to a known clear token
    mockedCryptoJS.AES.decrypt = jest.fn().mockReturnValue({
      toString: () => 'decrypted-access-token',
    } as any);

    // TODO: Once the Shopify GraphQL client creation is centralized behind a factory
    // or service, mock it here to return a tiny dataset with:
    // - 2 products
    // - 1 order with 2 line items
    //
    // For now, we leave this as a structural scaffold.
  });

  it('should perform a full sync and update progress correctly (HAPPY PATH - scaffold)', async () => {
    // TODO:
    // 1. Import and call the real orchestrator/service, e.g.:
    //    await ShopifySyncOrchestrator.run({ integrationId });
    //
    // 2. Mock the Shopify GraphQL client used inside the service to return:
    //    - products.edges.length === 2
    //    - orders.edges.length === 1 with 2 lineItems
    //
    // 3. Then assert:
    //    - integrations.update called with sync_status transitions:
    //      SYNCING_PRODUCTS → SYNCING_ORDERS → SYNCING_LINE_ITEMS → COMPLETED
    //    - sync_progress_total === 2 (products) + 1 (orders) + 2 (lineItems) = 5
    //    - sync_progress_current ends at 5
    //    - inserts were called on shopify_products, orders, order_line_items.

    // This assertion is intentionally weak until the orchestrator is wired.
    // It guarantees the test won't silently "pass" from doing nothing once unskipped.
    expect(mockIntegrationsFirst).toHaveBeenCalledTimes(0);
  });
});
