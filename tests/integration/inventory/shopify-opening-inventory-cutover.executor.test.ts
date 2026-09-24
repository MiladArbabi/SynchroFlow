const mockRequest = jest.fn();

const mockCreateShopifyGraphQLClient = jest.fn(() => ({
  request: mockRequest,
}));

jest.mock(
  'api-src/services/shopify/shopifyClient.service',
  () => ({
    createShopifyGraphQLClient: (...args: any[]) =>
      mockCreateShopifyGraphQLClient(...args),
  })
);

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import {
  encrypt,
} from 'api-src/security/encryption.service';

import {
  executeOpeningInventoryCutoverBatch,
} from 'api-src/services/wms/shopifyOpeningInventoryCutover.service';

import type {
  OpeningInventoryShopifyInput,
} from 'api-src/services/wms/openingInventoryCutover.service';

jest.setTimeout(60000);

type Fixture = {
  shopId: number;
  shopDomain: string;
};

const previousEncryptionKey =
  process.env.ENCRYPTION_KEY;

function makeInput(): OpeningInventoryShopifyInput {
  return {
    reason: 'correction',
    name: 'available',
    referenceDocumentUri:
      'gid://lasyncro/OpeningInventoryCutover/cutover-1/batch/1',
    changes: [
      {
        inventoryItemId:
          'gid://shopify/InventoryItem/101',
        locationId:
          'gid://shopify/Location/202',
        delta: -7,
        changeFromQuantity: null,
      },
    ],
  };
}

async function createFixture(): Promise<Fixture> {
  const shopDomain =
    `opening-executor-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.myshopify.com`;

  const shopId =
    await systemTransaction(async (trx) => {
      const id =
        await createTenantShop(
          trx,
          `opening-executor-${Date.now()}`
        );

      await setTenantContext(
        trx,
        id
      );

      return id;
    });

  await withTenant(
    shopId,
    (trx) =>
      trx(
        'shopify_app_installations'
      ).insert({
        shop_id: shopId,
        shop_domain:
          shopDomain,
        access_token:
          encrypt(
            'opening-executor-offline-token'
          ),
        scopes:
          'write_inventory',
      })
  );

  return {
    shopId,
    shopDomain,
  };
}

describe(
  '4b-2b Shopify opening inventory cutover executor',
  () => {
    beforeAll(() => {
      process.env.ENCRYPTION_KEY =
        'opening-executor-test-key-that-is-at-least-thirty-two-characters';
    });

    afterAll(() => {
      if (
        previousEncryptionKey ===
        undefined
      ) {
        delete process.env.ENCRYPTION_KEY;
      } else {
        process.env.ENCRYPTION_KEY =
          previousEncryptionKey;
      }
    });

    beforeEach(() => {
      mockRequest.mockReset();

      mockCreateShopifyGraphQLClient.mockClear();
      mockCreateShopifyGraphQLClient.mockImplementation(
        () => ({
          request:
            mockRequest,
        })
      );
    });

    it(
      'forwards the exact persisted input and deterministic idempotency key using Shopify native idempotency',
      async () => {
        const fixture =
          await createFixture();

        const input =
          makeInput();

        mockRequest.mockResolvedValue({
          data: {
            inventoryAdjustQuantities: {
              inventoryAdjustmentGroup: {
                id:
                  'gid://shopify/InventoryAdjustmentGroup/303',
                reason:
                  'correction',
                changes: [
                  {
                    name:
                      'available',
                    delta: -7,
                    quantityAfterChange:
                      88,
                  },
                ],
              },
              userErrors: [],
            },
          },
        });

        const idempotencyKey =
          'lasyncro:opening-cutover:cutover-1:1';

        const result =
          await executeOpeningInventoryCutoverBatch(
            {
              shopId:
                fixture.shopId,
              idempotencyKey,
              shopifyInput:
                input,
            }
          );

        expect(
          mockCreateShopifyGraphQLClient
        ).toHaveBeenCalledTimes(1);

        expect(
          mockCreateShopifyGraphQLClient
        ).toHaveBeenCalledWith({
          accessToken:
            'opening-executor-offline-token',
          platformShopName:
            fixture.shopDomain,
          shopId:
            fixture.shopId,
        });

        expect(
          mockRequest
        ).toHaveBeenCalledTimes(1);

        const [
          mutation,
          requestOptions,
        ] =
          mockRequest.mock.calls[0];

        expect(
          mutation
        ).toContain(
          '$idempotencyKey: String!'
        );

        expect(
          mutation
        ).toContain(
          '@idempotent(key: $idempotencyKey)'
        );

        expect(
          mutation
        ).toContain(
          'inventoryAdjustQuantities(input: $input)'
        );

        expect(
          requestOptions
        ).toEqual({
          variables: {
            idempotencyKey,
            input,
          },
        });

        expect(
          requestOptions.variables.input
        ).toEqual(input);

        expect(
          requestOptions.variables.input
            .changes[0]
            .changeFromQuantity
        ).toBeNull();

        expect(result).toEqual({
          adjustmentGroupId:
            'gid://shopify/InventoryAdjustmentGroup/303',
        });
      }
    );

    it(
      'surfaces Shopify userErrors and does not report provider success',
      async () => {
        const fixture =
          await createFixture();

        mockRequest.mockResolvedValue({
          data: {
            inventoryAdjustQuantities: {
              inventoryAdjustmentGroup:
                null,
              userErrors: [
                {
                  field: [
                    'input',
                    'changes',
                    '0',
                  ],
                  message:
                    'Inventory item cannot be adjusted',
                },
              ],
            },
          },
        });

        await expect(
          executeOpeningInventoryCutoverBatch(
            {
              shopId:
                fixture.shopId,
              idempotencyKey:
                'lasyncro:opening-cutover:user-error:1',
              shopifyInput:
                makeInput(),
            }
          )
        ).rejects.toThrow(
          /userErrors.*Inventory item cannot be adjusted/
        );

        expect(
          mockRequest
        ).toHaveBeenCalledTimes(1);
      }
    );

    it(
      'fails closed when Shopify returns no userErrors but omits the adjustment group id',
      async () => {
        const fixture =
          await createFixture();

        mockRequest.mockResolvedValue({
          data: {
            inventoryAdjustQuantities: {
              inventoryAdjustmentGroup:
                null,
              userErrors: [],
            },
          },
        });

        await expect(
          executeOpeningInventoryCutoverBatch(
            {
              shopId:
                fixture.shopId,
              idempotencyKey:
                'lasyncro:opening-cutover:missing-group:1',
              shopifyInput:
                makeInput(),
            }
          )
        ).rejects.toThrow(
          /missing inventoryAdjustmentGroup\.id/
        );
      }
    );

    it(
      'rejects an empty idempotency key before Shopify transport',
      async () => {
        const fixture =
          await createFixture();

        await expect(
          executeOpeningInventoryCutoverBatch(
            {
              shopId:
                fixture.shopId,
              idempotencyKey:
                '   ',
              shopifyInput:
                makeInput(),
            }
          )
        ).rejects.toThrow(
          /idempotencyKey is required/
        );

        expect(
          mockCreateShopifyGraphQLClient
        ).not.toHaveBeenCalled();

        expect(
          mockRequest
        ).not.toHaveBeenCalled();
      }
    );

    it(
      'rejects provider payloads that violate frozen additive-delta semantics before Shopify transport',
      async () => {
        const fixture =
          await createFixture();

        const invalid =
          makeInput();

        invalid.changes[0] = {
          ...invalid.changes[0],
          delta: 0,
        };

        await expect(
          executeOpeningInventoryCutoverBatch(
            {
              shopId:
                fixture.shopId,
              idempotencyKey:
                'lasyncro:opening-cutover:invalid-input:1',
              shopifyInput:
                invalid,
            }
          )
        ).rejects.toThrow(
          /Invalid persisted Shopify change/
        );

        expect(
          mockCreateShopifyGraphQLClient
        ).not.toHaveBeenCalled();

        expect(
          mockRequest
        ).not.toHaveBeenCalled();
      }
    );
  }
);
