// GH-1179 Slice D — immutable Opening Inventory cutover generation.
//
// RED contract:
// - fresh current Shopify Location on_hand, never historical arithmetic;
// - CURRENT Slice-C physical target;
// - served Shopify API version from provider response headers;
// - absolute on_hand + changeFromQuantity CAS;
// - immutable generation / entries / batches;
// - zero-diff retained as evidence but omitted from mutation batches;
// - unknown provider zero retained; unknown nonzero fails closed;
// - no legacy available/delta persistence;
// - no Shopify mutation execution in Slice D.
//
// All Shopify reads are dependency-injected. The real Shopify client is mocked
// fail-closed so this suite cannot create external provider traffic.

const mockShopifyRequest = jest.fn(async () => {
  throw new Error(
    '[GH1179_D_TEST] default Shopify transport must not be reached'
  );
});

const mockCreateShopifyGraphQLClient = jest.fn(() => ({
  request: mockShopifyRequest,
}));

jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: (...args: any[]) =>
    mockCreateShopifyGraphQLClient(...args),
}));

import crypto from 'crypto';
import { knex as knexFactory } from 'knex';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

import {
  addOpeningInventoryRecountLine,
  claimRecountTask,
  completeOpeningInventoryBin,
  recordCount,
} from 'api-src/services/wms/inventoryRecount.service';

import {
  startShopOpeningInventory,
  type OpeningInventoryLocationPageReader,
} from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';

import * as cutoverModule from
  'api-src/services/wms/openingInventoryCutover.service';

jest.setTimeout(120000);

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';

type CreateGeneration = (
  params: {
    shopId: number;
    actingUserId: number;
    acceptPhysicalTruth?: boolean;
  },
  deps?: {
    readLocationPage?: OpeningInventoryLocationPageReader;
  }
) => Promise<any>;

type Fixture = {
  shopId: number;
  ownerId: number;
  operatorId: number;
  warehouseId: string;
  rootCode: string;
  a1: string;
  a2: string;
  locationGid: string;
  variantId: string;
  itemGid: string;
  variantGid: string;
};

type ProviderLevel = {
  itemGid: string;
  variantGid?: string | null;
  onHand: number;
  active?: boolean;
  tracked?: boolean;
};

const originalApiVersion = process.env.SHOPIFY_API_VERSION;

beforeAll(() => {
  process.env.SHOPIFY_API_VERSION = '2026-04';
});

afterAll(() => {
  if (originalApiVersion === undefined) {
    delete process.env.SHOPIFY_API_VERSION;
  } else {
    process.env.SHOPIFY_API_VERSION = originalApiVersion;
  }
});

beforeEach(() => {
  mockShopifyRequest.mockClear();
  mockCreateShopifyGraphQLClient.mockClear();
});

function requireGenerationCreator(): CreateGeneration {
  const candidate =
    (cutoverModule as any).createOpeningInventoryCutoverGeneration;

  expect(typeof candidate).toBe('function');

  return candidate as CreateGeneration;
}

function providerPage(params: {
  fixture: Fixture;
  levels: ProviderLevel[];
  servedVersion?: string | null;
  hasNextPage?: boolean;
  endCursor?: string | null;
}) {
  const nodes = params.levels.map((level, index) => ({
    id:
      `gid://shopify/InventoryLevel/${index + 1}` +
      `?inventory_item_id=${level.itemGid.split('/').pop()}`,
    isActive: level.active ?? true,
    item: {
      id: level.itemGid,
      tracked: level.tracked ?? true,
      variant:
        level.variantGid === null
          ? null
          : {
              id:
                level.variantGid ??
                params.fixture.variantGid,
            },
    },
    quantities: [
      {
        name: 'on_hand',
        quantity: level.onHand,
      },
    ],
  }));

  const servedVersion =
    params.servedVersion === undefined
      ? '2026-04'
      : params.servedVersion;

  return {
    data: {
      location: {
        id: params.fixture.locationGid,
        isActive: true,
        inventoryLevels: {
          pageInfo: {
            hasNextPage:
              params.hasNextPage ?? false,
            endCursor:
              params.endCursor ?? null,
          },
          nodes,
        },
      },
    },
    headers:
      servedVersion === null
        ? {}
        : {
            'X-Shopify-API-Version': [
              servedVersion,
            ],
          },
  };
}

function pageReader(
  responses: unknown[],
  calls: Array<{
    shopId: number;
    variables: unknown;
  }> = []
): OpeningInventoryLocationPageReader {
  let index = 0;

  return async (params) => {
    calls.push({
      shopId: params.shopId,
      variables: params.variables,
    });

    if (index >= responses.length) {
      throw new Error(
        '[GH1179_D_TEST] provider reader exhausted'
      );
    }

    const response = responses[index];
    index += 1;
    return response;
  };
}

async function createFixture(): Promise<Fixture> {
  expect(process.env.PGDATABASE)
    .toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const unique =
    crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(
    async (trx) => {
      const id = await createTenantShop(
        trx,
        `gh1179d-${unique}`
      );

      await setTenantContext(trx, id);
      return id;
    }
  );

  const warehouseId = crypto.randomUUID();
  const rootCode = `D-${unique}-ROOT`;
  const a1 = `D-${unique}-A1`;
  const a2 = `D-${unique}-A2`;

  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  const locationRaw = `20${shopId}`;
  const inventoryItemRaw = `${shopId}001`;
  const variantRaw = `${shopId}101`;

  const itemGid =
    `gid://shopify/InventoryItem/${inventoryItemRaw}`;

  const variantGid =
    `gid://shopify/ProductVariant/${variantRaw}`;

  let ownerId = 0;
  let operatorId = 0;

  await withTenant(shopId, async (trx) => {
    const users = await trx('users')
      .insert([
        {
          shop_id: shopId,
          email: `d-owner-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'owner',
        },
        {
          shop_id: shopId,
          email: `d-operator-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'operator',
        },
      ])
      .returning(['id', 'role']);

    ownerId = Number(
      users.find(
        (row: any) => row.role === 'owner'
      )!.id
    );

    operatorId = Number(
      users.find(
        (row: any) => row.role === 'operator'
      )!.id
    );

    await trx('shop_memberships').insert([
      {
        shop_id: shopId,
        user_id: ownerId,
        role: 'owner',
      },
      {
        shop_id: shopId,
        user_id: operatorId,
        role: 'operator',
      },
    ]);

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model:
        'reconcile_opening_expectation_v2',
    });

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: `Slice D warehouse ${unique}`,
      root_location_code: rootCode,
      is_default: true,
      active: true,
      external_location_id: locationRaw,
    });

    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: a1,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: a2,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'storage',
      },
    ]);

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Slice D product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `D-${unique}`,
      title: 'Slice D variant',
      unit_cost: '1.00',
      status: 'active',
    });

    await trx(
      'external_product_identity_map'
    ).insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shopId,
      platform: 'shopify',
      external_product_id:
        `gid://shopify/Product/${shopId}01`,
      external_variant_id: variantGid,
      external_inventory_item_id:
        inventoryItemRaw,
      external_sku: `D-${unique}`,
    });

    await trx(
      'shopify_app_installations'
    ).insert({
      shop_id: shopId,
      shop_domain:
        `gh1179d-${unique}.myshopify.com`,
      access_token: 'test-token-no-network',
      scopes:
        'read_products,write_inventory',
    });
  });

  return {
    shopId,
    ownerId,
    operatorId,
    warehouseId,
    rootCode,
    a1,
    a2,
    locationGid:
      `gid://shopify/Location/${locationRaw}`,
    variantId,
    itemGid,
    variantGid,
  };
}

async function countOpeningBin(
  fixture: Fixture,
  recountTaskId: string,
  quantity: number | null
): Promise<void> {
  await withTenant(
    fixture.shopId,
    (trx) =>
      claimRecountTask(
        trx,
        fixture.shopId,
        recountTaskId,
        fixture.operatorId
      )
  );

  if (quantity !== null) {
    const line = await withTenant(
      fixture.shopId,
      (trx) =>
        addOpeningInventoryRecountLine(
          trx,
          {
            shopId: fixture.shopId,
            recountTaskId,
            lasyncroVariantId:
              fixture.variantId,
            addedBy:
              fixture.operatorId,
          }
        )
    );

    await withTenant(
      fixture.shopId,
      (trx) =>
        recordCount(trx, {
          shopId: fixture.shopId,
          recountTaskId,
          recountLineId:
            line.recount_line_id,
          countedQuantity: quantity,
          countMethod: 'bin_quantity',
          countedBy:
            fixture.operatorId,
        })
    );
  }

  await withTenant(
    fixture.shopId,
    (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        recountTaskId,
        fixture.operatorId
      )
  );
}

async function seedTruth(
  fixture: Fixture,
  params: {
    locationCode?: string;
    quantity: number;
  }
): Promise<void> {
  const now = new Date();

  await withTenant(
    fixture.shopId,
    (trx) =>
      trx('inventory_truth')
        .insert({
          shop_id: fixture.shopId,
          lasyncro_variant_id:
            fixture.variantId,
          location_code:
            params.locationCode ??
            fixture.a1,
          on_hand_quantity:
            params.quantity,
          reserved_quantity: 0,
          committed_quantity: 0,
          available_quantity:
            Math.max(0, params.quantity),
          last_evaluated_at: now,
        })
        .onConflict([
          'shop_id',
          'lasyncro_variant_id',
          'location_code',
        ])
        .merge({
          on_hand_quantity:
            params.quantity,
          reserved_quantity: 0,
          committed_quantity: 0,
          available_quantity:
            Math.max(0, params.quantity),
          last_evaluated_at: now,
          updated_at: now,
        })
  );
}

async function makeCountedReady(
  fixture: Fixture,
  targetQuantity = 3,
  openingShopifyOnHand = 11
): Promise<void> {
  const startReader:
    OpeningInventoryLocationPageReader =
      async ({ variables }) => ({
        data: {
          location: {
            id: variables.locationId,
            isActive: true,
            inventoryLevels: {
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
              nodes: [
                {
                  id:
                    `gid://shopify/InventoryLevel/` +
                    `${fixture.shopId}001`,
                  isActive: true,
                  item: {
                    id: fixture.itemGid,
                    tracked: true,
                    variant: {
                      id: fixture.variantGid,
                    },
                  },
                  quantities: [
                    {
                      name: 'on_hand',
                      quantity:
                        openingShopifyOnHand,
                    },
                  ],
                },
              ],
            },
          },
        },
      });

  const started =
    await startShopOpeningInventory(
      {
        shopId: fixture.shopId,
        createdBy: fixture.ownerId,
        assignedTo:
          fixture.operatorId,
      },
      {
        readLocationPage: startReader,
      }
    );

  const first =
    started.bins.find(
      (row) =>
        row.location_code === fixture.a1
    );

  const second =
    started.bins.find(
      (row) =>
        row.location_code === fixture.a2
    );

  if (!first || !second) {
    throw new Error(
      '[GH1179_D_TEST] opening cohort bins missing'
    );
  }

  await countOpeningBin(
    fixture,
    first.recount_task_id,
    targetQuantity
  );

  await countOpeningBin(
    fixture,
    second.recount_task_id,
    null
  );

  // Slice C derives TARGET only from CURRENT inventory_truth.
  // Keep that truth explicit in this Slice-D fixture rather than relying
  // on count-projection side effects.
  await seedTruth(fixture, {
    quantity: targetQuantity,
  });
}

async function generationState(
  shopId: number
) {
  return withTenant(
    shopId,
    async (trx) => ({
      generations:
        await trx(GENERATIONS)
          .where({ shop_id: shopId })
          .orderBy(
            'generation_sequence',
            'asc'
          ),

      entries:
        await trx(ENTRIES)
          .where({ shop_id: shopId })
          .orderBy('ordinal', 'asc'),

      batches:
        await trx(BATCHES)
          .where({ shop_id: shopId })
          .orderBy('batch_index', 'asc'),

      legacyCutovers:
        await trx(
          'opening_inventory_cutovers'
        ).where({ shop_id: shopId }),

      legacyBatches:
        await trx(
          'opening_inventory_cutover_batches'
        ).where({ shop_id: shopId }),
    })
  );
}

function parseJson(value: unknown): any {
  return typeof value === 'string'
    ? JSON.parse(value)
    : value;
}


type ExtraTarget = {
  variantId: string;
  itemGid: string;
  variantGid: string;
};

function canonicalizeForFingerprint(
  value: unknown
): unknown {
  if (Array.isArray(value)) {
    return value.map(
      canonicalizeForFingerprint
    );
  }

  if (
    value !== null &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(
        value as Record<string, unknown>
      )
        .sort(
          ([left], [right]) =>
            left < right
              ? -1
              : left > right
                ? 1
                : 0
        )
        .map(
          ([key, nested]) => [
            key,
            canonicalizeForFingerprint(
              nested
            ),
          ]
        )
    );
  }

  return value;
}

function canonicalJsonForFingerprint(
  value: unknown
): string {
  return JSON.stringify(
    canonicalizeForFingerprint(value)
  );
}

function sha256Canonical(
  value: unknown
): string {
  return crypto
    .createHash('sha256')
    .update(
      canonicalJsonForFingerprint(
        value
      )
    )
    .digest('hex');
}

async function seedAdditionalTargets(
  fixture: Fixture,
  count: number,
  quantity = 1
): Promise<ExtraTarget[]> {
  if (count < 1) {
    return [];
  }

  return withTenant(
    fixture.shopId,
    async (trx) => {
      const baseVariant =
        await trx('variants')
          .where({
            shop_id:
              fixture.shopId,
            lasyncro_variant_id:
              fixture.variantId,
          })
          .select(
            'lasyncro_product_id'
          )
          .first();

      if (
        !baseVariant
          ?.lasyncro_product_id
      ) {
        throw new Error(
          '[GH1179_D_TEST] fixture product missing'
        );
      }

      const now = new Date();

      const result:
        ExtraTarget[] = [];

      const variants: any[] = [];
      const identities: any[] = [];
      const truthRows: any[] = [];

      for (
        let index = 0;
        index < count;
        index += 1
      ) {
        const variantId =
          crypto.randomUUID();

        const itemRaw =
          `${fixture.shopId}` +
          `${String(index + 5000)
            .padStart(7, '0')}`;

        const variantRaw =
          `${fixture.shopId}` +
          `${String(index + 8000)
            .padStart(7, '0')}`;

        const productRaw =
          `${fixture.shopId}` +
          `${String(index + 9000)
            .padStart(7, '0')}`;

        const itemGid =
          `gid://shopify/InventoryItem/${itemRaw}`;

        const variantGid =
          `gid://shopify/ProductVariant/${variantRaw}`;

        result.push({
          variantId,
          itemGid,
          variantGid,
        });

        variants.push({
          lasyncro_variant_id:
            variantId,

          lasyncro_product_id:
            baseVariant
              .lasyncro_product_id,

          shop_id:
            fixture.shopId,

          sku:
            `D-BULK-${index}-${variantId.slice(0, 8)}`,

          title:
            `Slice D bulk variant ${index}`,

          unit_cost:
            '1.00',

          status:
            'active',
        });

        identities.push({
          id:
            crypto.randomUUID(),

          lasyncro_variant_id:
            variantId,

          shop_id:
            fixture.shopId,

          platform:
            'shopify',

          external_product_id:
            `gid://shopify/Product/${productRaw}`,

          external_variant_id:
            variantGid,

          external_inventory_item_id:
            itemRaw,

          external_sku:
            `D-BULK-${index}`,
        });

        truthRows.push({
          shop_id:
            fixture.shopId,

          lasyncro_variant_id:
            variantId,

          location_code:
            fixture.a1,

          on_hand_quantity:
            quantity,

          reserved_quantity:
            0,

          committed_quantity:
            0,

          available_quantity:
            quantity,

          last_evaluated_at:
            now,
        });
      }

      await trx('variants')
        .insert(variants);

      await trx(
        'external_product_identity_map'
      ).insert(identities);

      await trx(
        'inventory_truth'
      ).insert(truthRows);

      return result;
    }
  );
}

// D25 TEST-ONLY: bounded poll that OBSERVES catalog/lock state. The barrier is
// the blocker's row lock; this loop never gates transactions on elapsed time.
async function waitForD25<T>(
  probe: () => Promise<T>,
  label: string,
  { tries = 400, intervalMs = 25 } = {}
): Promise<NonNullable<T>> {
  for (let i = 0; i < tries; i += 1) {
    const value = await probe();

    if (value) {
      return value as NonNullable<T>;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, intervalMs)
    );
  }

  throw new Error(
    `[GH1179_D25_TEST] waitFor timed out: ${label}`
  );
}

describe(
  'GH-1179 Slice D — immutable cutover generation service',
  () => {
    it(
      'D01 — exposes a dedicated generation-creation seam',
      () => {
        expect(
          typeof (cutoverModule as any)
            .createOpeningInventoryCutoverGeneration
        ).toBe('function');
      }
    );

    it(
      'D02/D03/D04/D05 — freezes CURRENT physical target against FRESH Shopify on_hand using absolute on_hand CAS',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        // Historical opening snapshot says 11.
        await makeCountedReady(
          fixture,
          3,
          11
        );

        // Fresh cutover read says 8.
        const calls: Array<{
          shopId: number;
          variables: unknown;
        }> = [];

        await create(
          {
            shopId: fixture.shopId,
            actingUserId:
              fixture.ownerId,
            acceptPhysicalTruth: true,
          },
          {
            readLocationPage:
              pageReader(
                [
                  providerPage({
                    fixture,
                    levels: [
                      {
                        itemGid:
                          fixture.itemGid,
                        variantGid:
                          fixture.variantGid,
                        onHand: 8,
                      },
                    ],
                  }),
                ],
                calls
              ),
          }
        );

        const state =
          await generationState(
            fixture.shopId
          );

        expect(calls).toHaveLength(1);

        expect(
          state.generations
        ).toHaveLength(1);

        expect(
          state.entries
        ).toHaveLength(1);

        expect(
          state.batches
        ).toHaveLength(1);

        const generation =
          state.generations[0];

        const entry =
          state.entries[0];

        const batch =
          state.batches[0];

        expect(
          generation.status
        ).toBe('frozen');

        expect(
          generation.requested_api_version
        ).toBe('2026-04');

        expect(
          generation.served_api_version
        ).toBe('2026-04');

        expect(
          generation.cas_mode
        ).toBe(
          'change_from_quantity'
        );

        expect(
          generation.quantity_name
        ).toBe('on_hand');

        expect(
          generation.target_item_count
        ).toBe(1);

        expect(
          generation.write_count
        ).toBe(1);

        expect(
          generation.batch_count
        ).toBe(1);

        expect({
          variant:
            entry.lasyncro_variant_id,
          item:
            entry.shopify_inventory_item_gid,
          target:
            entry.target_quantity,
          observed:
            entry.observed_on_hand_quantity,
          disposition:
            entry.disposition,
        }).toEqual({
          variant:
            fixture.variantId,
          item:
            fixture.itemGid,
          target: 3,
          observed: 8,
          disposition: 'write',
        });

        const variables =
          parseJson(
            batch.canonical_variables
          );

        expect(
          variables.input.name
        ).toBe('on_hand');

        expect(
          variables.input.reason
        ).toBe('correction');

        expect(
          variables.input.quantities
        ).toEqual([
          {
            inventoryItemId:
              fixture.itemGid,
            locationId:
              fixture.locationGid,
            quantity: 3,
            changeFromQuantity: 8,
          },
        ]);

        expect(
          variables.input.changes
        ).toBeUndefined();

        expect(
          JSON.stringify(variables)
        ).not.toContain('"delta"');

        expect(
          batch.idempotency_key
        ).toEqual(
          expect.any(String)
        );

        expect(
          batch.graphql_document
        ).toContain(
          'inventorySetQuantities'
        );

        expect(
          batch.graphql_document
        ).toContain('@idempotent');

        expect(
          batch.graphql_document
        ).toContain(
          'changeFromQuantity'
        );
      }
    );

    it(
      'D06 — missing served Shopify API version fails closed with no generation',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture
        );

        await expect(
          create(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                pageReader([
                  providerPage({
                    fixture,
                    levels: [
                      {
                        itemGid:
                          fixture.itemGid,
                        onHand: 3,
                      },
                    ],
                    servedVersion:
                      null,
                  }),
                ]),
            }
          )
        ).rejects.toBeDefined();

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D07 — unsupported served API version fails closed instead of emitting a legacy CAS serializer',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture
        );

        await expect(
          create(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                pageReader([
                  providerPage({
                    fixture,
                    levels: [
                      {
                        itemGid:
                          fixture.itemGid,
                        onHand: 3,
                      },
                    ],
                    servedVersion:
                      '2025-07',
                  }),
                ]),
            }
          )
        ).rejects.toBeDefined();

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D08 — unknown current provider item with nonzero on_hand blocks generation',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture
        );

        const unknown =
          `gid://shopify/InventoryItem/${fixture.shopId}999`;

        await expect(
          create(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                pageReader([
                  providerPage({
                    fixture,
                    levels: [
                      {
                        itemGid:
                          fixture.itemGid,
                        onHand: 3,
                      },
                      {
                        itemGid:
                          unknown,
                        variantGid: null,
                        onHand: 1,
                      },
                    ],
                  }),
                ]),
            }
          )
        ).rejects.toBeDefined();

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D09 — unknown current provider zero is retained as provider_only_zero evidence',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const unknown =
          `gid://shopify/InventoryItem/${fixture.shopId}999`;

        await create(
          {
            shopId:
              fixture.shopId,
            actingUserId:
              fixture.ownerId,
            acceptPhysicalTruth: true,
          },
          {
            readLocationPage:
              pageReader([
                providerPage({
                  fixture,
                  levels: [
                    {
                      itemGid:
                        fixture.itemGid,
                      onHand: 3,
                    },
                    {
                      itemGid:
                        unknown,
                      variantGid: null,
                      onHand: 0,
                    },
                  ],
                }),
              ]),
          }
        );

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(1);

        expect(
          state.generations[0]
            .provider_only_item_count
        ).toBe(1);

        expect(
          state.generations[0]
            .write_count
        ).toBe(0);

        expect(
          state.generations[0]
            .batch_count
        ).toBe(0);

        expect(
          state.entries
        ).toHaveLength(2);

        const providerOnly =
          state.entries.find(
            (row: any) =>
              row.disposition ===
              'provider_only_zero'
          );

        expect(
          providerOnly
            ?.shopify_inventory_item_gid
        ).toBe(unknown);

        expect(
          providerOnly
            ?.observed_on_hand_quantity
        ).toBe(0);

        expect(
          providerOnly
            ?.target_quantity
        ).toBeNull();
      }
    );

    it(
      'D10 — a known target absent from the current Shopify Location is not synthesized as zero',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        await expect(
          create(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                pageReader([
                  providerPage({
                    fixture,
                    levels: [],
                  }),
                ]),
            }
          )
        ).rejects.toBeDefined();

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it.each([
      {
        label:
          'inactive inventory level',
        active: false,
        tracked: true,
      },
      {
        label:
          'untracked inventory item',
        active: true,
        tracked: false,
      },
    ])(
      'D11 — $label fails closed before freezing a writable target',
      async ({ active, tracked }) => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        await expect(
          create(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                pageReader([
                  providerPage({
                    fixture,
                    levels: [
                      {
                        itemGid:
                          fixture.itemGid,
                        onHand: 2,
                        active,
                        tracked,
                      },
                    ],
                  }),
                ]),
            }
          )
        ).rejects.toBeDefined();

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D12 — target equals current on_hand freezes no_op evidence with zero mutation batches',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3,
          11
        );

        await create(
          {
            shopId:
              fixture.shopId,
            actingUserId:
              fixture.ownerId,
            acceptPhysicalTruth: true,
          },
          {
            readLocationPage:
              pageReader([
                providerPage({
                  fixture,
                  levels: [
                    {
                      itemGid:
                        fixture.itemGid,
                      onHand: 3,
                    },
                  ],
                }),
              ]),
          }
        );

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations[0].status
        ).toBe('frozen');

        expect(
          state.generations[0]
            .target_item_count
        ).toBe(1);

        expect(
          state.generations[0]
            .write_count
        ).toBe(0);

        expect(
          state.generations[0]
            .batch_count
        ).toBe(0);

        expect(
          state.entries
        ).toHaveLength(1);

        expect(
          state.entries[0]
            .disposition
        ).toBe('no_op');

        expect(
          state.entries[0]
            .target_quantity
        ).toBe(3);

        expect(
          state.entries[0]
            .observed_on_hand_quantity
        ).toBe(3);

        expect(
          state.batches
        ).toHaveLength(0);
      }
    );

    it(
      'D13 — replay returns the already frozen immutable generation without another provider read',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const firstCalls: Array<{
          shopId: number;
          variables: unknown;
        }> = [];

        const first =
          await create(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                pageReader(
                  [
                    providerPage({
                      fixture,
                      levels: [
                        {
                          itemGid:
                            fixture.itemGid,
                          onHand: 4,
                        },
                      ],
                    }),
                  ],
                  firstCalls
                ),
            }
          );

        const secondReader:
          OpeningInventoryLocationPageReader =
            async () => {
              throw new Error(
                '[GH1179_D_TEST] replay must not reread Shopify'
              );
            };

        const second =
          await create(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                secondReader,
            }
          );

        expect(firstCalls)
          .toHaveLength(1);

        expect(
          second.generation_id
        ).toBe(
          first.generation_id
        );

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(1);

        expect(
          state.batches
        ).toHaveLength(1);
      }
    );

    it(
      'D14 — Slice-C readiness failure blocks before provider I/O',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        await seedTruth(
          fixture,
          {
            locationCode:
              fixture.rootCode,
            quantity: 1,
          }
        );

        const provider =
          jest.fn(
            async () =>
              providerPage({
                fixture,
                levels: [
                  {
                    itemGid:
                      fixture.itemGid,
                    onHand: 3,
                  },
                ],
              })
          );

        await expect(
          create(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                provider,
            }
          )
        ).rejects.toBeDefined();

        expect(provider)
          .toHaveBeenCalledTimes(0);

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D15 — operator cannot create a generation and provider is not called',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const provider =
          jest.fn(
            async () =>
              providerPage({
                fixture,
                levels: [
                  {
                    itemGid:
                      fixture.itemGid,
                    onHand: 3,
                  },
                ],
              })
          );

        await expect(
          create(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.operatorId,
              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                provider,
            }
          )
        ).rejects.toBeDefined();

        expect(provider)
          .toHaveBeenCalledTimes(0);

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D16 — Slice D creates no legacy available/delta cutover persistence',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        await create(
          {
            shopId:
              fixture.shopId,
            actingUserId:
              fixture.ownerId,
            acceptPhysicalTruth:
              true,
          },
          {
            readLocationPage:
              pageReader([
                providerPage({
                  fixture,
                  levels: [
                    {
                      itemGid:
                        fixture.itemGid,
                      onHand: 8,
                    },
                  ],
                }),
              ]),
          }
        );

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(1);

        expect(
          state.legacyCutovers
        ).toHaveLength(0);

        expect(
          state.legacyBatches
        ).toHaveLength(0);

        // The injected dependency is read-only. Slice D has no executor
        // dependency and must never call the mocked default Shopify client.
        expect(
          mockShopifyRequest
        ).toHaveBeenCalledTimes(0);
      }
    );
    it(
      'D17 — provider ProductVariant identity mismatch for a known InventoryItem blocks generation',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const mismatchedVariantGid =
          `gid://shopify/ProductVariant/${fixture.shopId}999999`;

        await expect(
          create(
            {
              shopId:
                fixture.shopId,

              actingUserId:
                fixture.ownerId,

              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                pageReader([
                  providerPage({
                    fixture,

                    levels: [
                      {
                        itemGid:
                          fixture.itemGid,

                        variantGid:
                          mismatchedVariantGid,

                        onHand:
                          8,
                      },
                    ],
                  }),
                ]),
            }
          )
        ).rejects.toBeDefined();

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D18 — served Shopify API version changing between pagination pages fails closed',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const unknownZero =
          `gid://shopify/InventoryItem/${fixture.shopId}999`;

        const calls: Array<{
          shopId: number;
          variables: unknown;
        }> = [];

        await expect(
          create(
            {
              shopId:
                fixture.shopId,

              actingUserId:
                fixture.ownerId,

              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                pageReader(
                  [
                    providerPage({
                      fixture,

                      levels: [
                        {
                          itemGid:
                            fixture.itemGid,

                          variantGid:
                            fixture.variantGid,

                          onHand:
                            8,
                        },
                      ],

                      servedVersion:
                        '2026-04',

                      hasNextPage:
                        true,

                      endCursor:
                        'page-1',
                    }),

                    providerPage({
                      fixture,

                      levels: [
                        {
                          itemGid:
                            unknownZero,

                          variantGid:
                            null,

                          onHand:
                            0,
                        },
                      ],

                      servedVersion:
                        '2026-07',

                      hasNextPage:
                        false,

                      endCursor:
                        null,
                    }),
                  ],
                  calls
                ),
            }
          )
        ).rejects.toBeDefined();

        expect(calls)
          .toHaveLength(2);

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D19 — multi-page fresh read with one served version persists complete page-count evidence',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const unknownZero =
          `gid://shopify/InventoryItem/${fixture.shopId}999`;

        const calls: Array<{
          shopId: number;
          variables: any;
        }> = [];

        await create(
          {
            shopId:
              fixture.shopId,

            actingUserId:
              fixture.ownerId,

            acceptPhysicalTruth:
              true,
          },
          {
            readLocationPage:
              pageReader(
                [
                  providerPage({
                    fixture,

                    levels: [
                      {
                        itemGid:
                          fixture.itemGid,

                        variantGid:
                          fixture.variantGid,

                        onHand:
                          8,
                      },
                    ],

                    servedVersion:
                      '2026-04',

                    hasNextPage:
                      true,

                    endCursor:
                      'page-1',
                  }),

                  providerPage({
                    fixture,

                    levels: [
                      {
                        itemGid:
                          unknownZero,

                        variantGid:
                          null,

                        onHand:
                          0,
                      },
                    ],

                    servedVersion:
                      '2026-04',

                    hasNextPage:
                      false,

                    endCursor:
                      null,
                  }),
                ],
                calls
              ),
          }
        );

        expect(calls)
          .toHaveLength(2);

        expect(
          (calls[0].variables as any)
            .after
        ).toBeNull();

        expect(
          (calls[1].variables as any)
            .after
        ).toBe('page-1');

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(1);

        expect(
          state.generations[0]
            .provider_page_count
        ).toBe(2);

        expect(
          state.generations[0]
            .served_api_version
        ).toBe('2026-04');

        expect(
          state.generations[0]
            .provider_only_item_count
        ).toBe(1);

        expect(
          state.entries
        ).toHaveLength(2);
      }
    );

    it(
      'D20 — 251 writes are sorted deterministically and frozen as batches 250 + 1',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          1
        );

        const extras =
          await seedAdditionalTargets(
            fixture,
            250,
            1
          );

        const providerLevels:
          ProviderLevel[] = [
            {
              itemGid:
                fixture.itemGid,

              variantGid:
                fixture.variantGid,

              onHand:
                0,
            },

            ...extras.map(
              (extra) => ({
                itemGid:
                  extra.itemGid,

                variantGid:
                  extra.variantGid,

                onHand:
                  0,
              })
            ),
          ];

        // Intentionally reverse provider order. Persisted mutation order must
        // come from canonical item identity, never provider page/node order.
        providerLevels.reverse();

        await create(
          {
            shopId:
              fixture.shopId,

            actingUserId:
              fixture.ownerId,

            acceptPhysicalTruth:
              true,
          },
          {
            readLocationPage:
              pageReader([
                providerPage({
                  fixture,
                  levels:
                    providerLevels,
                }),
              ]),
          }
        );

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(1);

        expect(
          state.generations[0]
            .write_count
        ).toBe(251);

        expect(
          state.generations[0]
            .batch_count
        ).toBe(2);

        expect(
          state.batches.map(
            (row: any) =>
              row.entry_count
          )
        ).toEqual([
          250,
          1,
        ]);

        const writeEntries =
          state.entries.filter(
            (row: any) =>
              row.disposition ===
              'write'
          );

        expect(
          writeEntries
        ).toHaveLength(251);

        const persistedItemIds =
          writeEntries.map(
            (row: any) =>
              String(
                row.shopify_inventory_item_gid
              )
          );

        const sortedItemIds =
          [...persistedItemIds]
            .sort();

        expect(
          persistedItemIds
        ).toEqual(
          sortedItemIds
        );

        const firstVariables =
          parseJson(
            state.batches[0]
              .canonical_variables
          );

        const secondVariables =
          parseJson(
            state.batches[1]
              .canonical_variables
          );

        expect(
          firstVariables
            .input
            .quantities
            .map(
              (row: any) =>
                row.inventoryItemId
            )
        ).toEqual(
          sortedItemIds.slice(
            0,
            250
          )
        );

        expect(
          secondVariables
            .input
            .quantities
            .map(
              (row: any) =>
                row.inventoryItemId
            )
        ).toEqual(
          sortedItemIds.slice(
            250
          )
        );

        expect(
          writeEntries[0]
            .batch_index
        ).toBe(1);

        expect(
          writeEntries[249]
            .batch_index
        ).toBe(1);

        expect(
          writeEntries[249]
            .batch_position
        ).toBe(250);

        expect(
          writeEntries[250]
            .batch_index
        ).toBe(2);

        expect(
          writeEntries[250]
            .batch_position
        ).toBe(1);
      }
    );

    it(
      'D21 — semantic and exact-request fingerprints are canonical and exclude transient generation timestamps',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        await create(
          {
            shopId:
              fixture.shopId,

            actingUserId:
              fixture.ownerId,

            acceptPhysicalTruth:
              true,
          },
          {
            readLocationPage:
              pageReader([
                providerPage({
                  fixture,

                  levels: [
                    {
                      itemGid:
                        fixture.itemGid,

                      variantGid:
                        fixture.variantGid,

                      onHand:
                        8,
                    },
                  ],
                }),
              ]),
          }
        );

        const state =
          await generationState(
            fixture.shopId
          );

        const generation =
          state.generations[0];

        const batch =
          state.batches[0];

        expect(
          batch.canonical_variables
        ).toBe(
          canonicalJsonForFingerprint(
            parseJson(
              batch.canonical_variables
            )
          )
        );

        const variables =
          parseJson(
            batch.canonical_variables
          );

        expect(
          variables.idempotencyKey
        ).toBe(
          batch.idempotency_key
        );

        expect(
          variables.input
            .referenceDocumentUri
        ).toBe(
          batch.reference_document_uri
        );

        const expectedRequestHash =
          sha256Canonical({
            operationName:
              batch.operation_name,

            graphqlDocument:
              batch.graphql_document,

            requestedApiVersion:
              batch.requested_api_version,

            servedApiVersion:
              batch.served_api_version,

            casMode:
              batch.cas_mode,

            canonicalVariables:
              batch.canonical_variables,
          });

        expect(
          batch.request_sha256
        ).toBe(
          expectedRequestHash
        );

        const semanticEntries =
          state.entries.map(
            (entry: any) => ({
              lasyncroVariantId:
                entry.lasyncro_variant_id,

              shopifyInventoryItemGid:
                entry.shopify_inventory_item_gid,

              targetQuantity:
                entry.target_quantity,

              observedOnHandQuantity:
                entry.observed_on_hand_quantity,

              disposition:
                entry.disposition,

              batchIndex:
                entry.batch_index,

              batchPosition:
                entry.batch_position,
            })
          );

        const expectedGenerationFingerprint =
          sha256Canonical({
            snapshotId:
              generation.opening_snapshot_id,

            warehouseId:
              generation.warehouse_id,

            locationGid:
              generation.shopify_location_gid,

            shopDomain:
              generation.shopify_shop_domain,

            requestedApiVersion:
              generation.requested_api_version,

            servedApiVersion:
              generation.served_api_version,

            casMode:
              generation.cas_mode,

            quantityName:
              generation.quantity_name,

            reason:
              generation.reason,

            identityFingerprint:
              generation.identity_fingerprint,

            targetFingerprint:
              generation.target_fingerprint,

            providerReadFingerprint:
              generation.provider_read_fingerprint,

            entries:
              semanticEntries,
          });

        expect(
          generation
            .generation_fingerprint
        ).toBe(
          expectedGenerationFingerprint
        );
      }
    );

    it(
      'D22 — Shopify identity drift during provider I/O blocks T2 freeze',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const reader:
          OpeningInventoryLocationPageReader =
            async ({ variables }) => {
              await withTenant(
                fixture.shopId,
                (trx) =>
                  trx(
                    'external_product_identity_map'
                  )
                    .where({
                      shop_id:
                        fixture.shopId,

                      lasyncro_variant_id:
                        fixture.variantId,

                      platform:
                        'shopify',
                    })
                    .update({
                      external_variant_id:
                        `gid://shopify/ProductVariant/${fixture.shopId}777777`,
                    })
              );

              return providerPage({
                fixture,

                levels: [
                  {
                    itemGid:
                      fixture.itemGid,

                    variantGid:
                      fixture.variantGid,

                    onHand:
                      8,
                  },
                ],
              });
            };

        await expect(
          create(
            {
              shopId:
                fixture.shopId,

              actingUserId:
                fixture.ownerId,

              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                reader,
            }
          )
        ).rejects.toBeDefined();

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D23 — physical truth changing during provider I/O is recomputed in T2 and the fresh target is frozen',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const reader:
          OpeningInventoryLocationPageReader =
            async () => {
              await seedTruth(
                fixture,
                {
                  quantity:
                    4,
                }
              );

              return providerPage({
                fixture,

                levels: [
                  {
                    itemGid:
                      fixture.itemGid,

                    variantGid:
                      fixture.variantGid,

                    onHand:
                      8,
                  },
                ],
              });
            };

        await create(
          {
            shopId:
              fixture.shopId,

            actingUserId:
              fixture.ownerId,

            acceptPhysicalTruth:
              true,
          },
          {
            readLocationPage:
              reader,
          }
        );

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.entries
        ).toHaveLength(1);

        expect(
          state.entries[0]
            .target_quantity
        ).toBe(4);

        expect(
          state.entries[0]
            .observed_on_hand_quantity
        ).toBe(8);

        const variables =
          parseJson(
            state.batches[0]
              .canonical_variables
          );

        expect(
          variables
            .input
            .quantities[0]
        ).toMatchObject({
          quantity:
            4,

          changeFromQuantity:
            8,
        });
      }
    );

    it(
      'D24 — readiness becoming unsafe during provider I/O blocks T2 freeze',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const reader:
          OpeningInventoryLocationPageReader =
            async () => {
              await seedTruth(
                fixture,
                {
                  locationCode:
                    fixture.rootCode,

                  quantity:
                    1,
                }
              );

              return providerPage({
                fixture,

                levels: [
                  {
                    itemGid:
                      fixture.itemGid,

                    variantGid:
                      fixture.variantGid,

                    onHand:
                      8,
                  },
                ],
              });
            };

        await expect(
          create(
            {
              shopId:
                fixture.shopId,

              actingUserId:
                fixture.ownerId,

              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                reader,
            }
          )
        ).rejects.toBeDefined();

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.generations
        ).toHaveLength(0);
      }
    );

    it(
      'D25 — T2 reads one consistent snapshot while physical truth changes concurrently',
      async () => {
        const create =
          requireGenerationCreator();

        const fixture =
          await createFixture();

        await makeCountedReady(
          fixture,
          3
        );

        const testDb =
          String(process.env.PGDATABASE);

        expect(testDb)
          .toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

        // Independent coordinator: read-only catalog probes only. Uses the
        // restricted runtime role so it can see the generation backend's
        // query text in pg_stat_activity (same role).
        const coord = knexFactory({
          client: 'pg',
          connection: {
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT),
            user: process.env.PGUSER,
            password:
              String(process.env.PGPASSWORD || ''),
            database: testDb,
          },
          pool: { min: 1, max: 1 },
        });

        let releaseBlocker: () => void =
          () => undefined;

        const blockerReleased =
          new Promise<void>((resolve) => {
            releaseBlocker = resolve;
          });

        let markBlockerLocked:
          (pid: number) => void =
            () => undefined;

        const blockerLocked =
          new Promise<number>((resolve) => {
            markBlockerLocked = resolve;
          });

        let blockerPromise:
          Promise<void> | null = null;

        let generationOutcome:
          Promise<
            | { ok: true; value: any }
            | { ok: false; error: unknown }
          > | null = null;

        let generationSettled = false;
        let bodyOk = false;

        const readerCalls: Array<{
          shopId: number;
          variables: unknown;
        }> = [];

        let outcome:
          | { ok: true; value: any }
          | { ok: false; error: unknown }
          | undefined;

        let evidence: Record<string, unknown> = {};
        let leakedLocks: unknown[] = [];

        try {
          const who =
            await coord.raw(
              'SELECT current_database() AS db'
            );

          expect(who.rows[0].db).toBe(testDb);

          // 1. Blocker: tenant-correct transaction holding a row-level
          //    UPDATE lock on the fixture's Shopify identity row.
          blockerPromise = withTenant(
            fixture.shopId,
            async (trx) => {
              const pidResult =
                await trx.raw(
                  'SELECT pg_backend_pid() AS pid'
                );

              const locked =
                await trx(
                  'external_product_identity_map'
                )
                  .where({
                    shop_id:
                      fixture.shopId,

                    lasyncro_variant_id:
                      fixture.variantId,

                    platform:
                      'shopify',
                  })
                  .forUpdate()
                  .select('id');

              if (locked.length !== 1) {
                throw new Error(
                  '[GH1179_D25_TEST] fixture identity row not locked'
                );
              }

              markBlockerLocked(
                Number(pidResult.rows[0].pid)
              );

              await blockerReleased;
            }
          );

          const blockerPid =
            await Promise.race([
              blockerLocked,
              blockerPromise.then(() => {
                throw new Error(
                  '[GH1179_D25_TEST] blocker ended before locking'
                );
              }),
            ]);

          // 2. Start generation asynchronously with the mocked provider.
          generationOutcome = create(
            {
              shopId:
                fixture.shopId,

              actingUserId:
                fixture.ownerId,

              acceptPhysicalTruth:
                true,
            },
            {
              readLocationPage:
                pageReader(
                  [
                    providerPage({
                      fixture,

                      levels: [
                        {
                          itemGid:
                            fixture.itemGid,

                          variantGid:
                            fixture.variantGid,

                          onHand:
                            8,
                        },
                      ],
                    }),
                  ],
                  readerCalls
                ),
            }
          ).then(
            (value: any) => {
              generationSettled = true;
              return { ok: true as const, value };
            },
            (error: unknown) => {
              generationSettled = true;
              return { ok: false as const, error };
            }
          );

          // 3. PROVE T2 is blocked by the blocker while already open.
          const blocked =
            await waitForD25(
              async () => {
                if (generationSettled) {
                  throw new Error(
                    '[GH1179_D25_TEST] generation settled before T2 was observed blocked: ' +
                      JSON.stringify(
                        await generationOutcome
                      )
                  );
                }

                const result =
                  await coord.raw(
                    `SELECT a.pid,
                            a.state,
                            a.wait_event_type,
                            a.wait_event,
                            a.query,
                            pg_blocking_pids(a.pid) AS blockers,
                            EXISTS (
                              SELECT 1 FROM pg_locks l
                               WHERE l.pid = a.pid
                                 AND l.locktype = 'advisory'
                                 AND l.granted
                            ) AS holds_advisory_lock,
                            EXISTS (
                              SELECT 1 FROM pg_locks l
                               WHERE l.pid = a.pid
                                 AND l.locktype = 'tuple'
                                 AND l.relation =
                                   'external_product_identity_map'::regclass
                            ) AS holds_identity_tuple_lock
                       FROM pg_stat_activity a
                      WHERE a.datname = current_database()
                        AND a.backend_type = 'client backend'
                        AND a.pid <> ?
                        AND ? = ANY(pg_blocking_pids(a.pid))
                      LIMIT 1`,
                    [blockerPid, blockerPid]
                  );

                return result.rows[0] ?? null;
              },
              'generation T2 blocked by identity-row blocker'
            );

          expect(readerCalls).toHaveLength(1);
          expect(blocked.wait_event_type).toBe('Lock');
          expect(blocked.holds_advisory_lock).toBe(true);
          expect(String(blocked.query))
            .toMatch(/external_product_identity_map/);
          expect(String(blocked.query))
            .toMatch(/for share/i);

          const t2Pid = Number(blocked.pid);

          // 4. Concurrent committed truth mutation 3 -> 4 while T2 is open.
          const truthBefore =
            await withTenant(
              fixture.shopId,
              (trx) =>
                trx('inventory_truth')
                  .where({
                    shop_id:
                      fixture.shopId,

                    lasyncro_variant_id:
                      fixture.variantId,

                    location_code:
                      fixture.a1,
                  })
                  .first('on_hand_quantity')
            );

          await seedTruth(
            fixture,
            {
              quantity:
                4,
            }
          );

          const truthCommitted =
            await withTenant(
              fixture.shopId,
              (trx) =>
                trx('inventory_truth')
                  .where({
                    shop_id:
                      fixture.shopId,

                    lasyncro_variant_id:
                      fixture.variantId,

                    location_code:
                      fixture.a1,
                  })
                  .first('on_hand_quantity')
            );

          expect(
            Number(truthBefore.on_hand_quantity)
          ).toBe(3);

          expect(
            Number(truthCommitted.on_hand_quantity)
          ).toBe(4);

          // T2 is STILL blocked after the mutation committed.
          const stillBlocked =
            await coord.raw(
              `SELECT ? = ANY(pg_blocking_pids(?)) AS blocked`,
              [blockerPid, t2Pid]
            );

          expect(stillBlocked.rows[0].blocked).toBe(true);
          expect(generationSettled).toBe(false);

          evidence = {
            blockerPid,
            t2Pid,
            blockers: blocked.blockers,
            state: blocked.state,
            waitEventType: blocked.wait_event_type,
            waitEvent: blocked.wait_event,
            holdsAdvisoryLock:
              blocked.holds_advisory_lock,
            holdsIdentityTupleLock:
              blocked.holds_identity_tuple_lock,
            query:
              String(blocked.query)
                .replace(/\s+/g, ' ')
                .slice(0, 400),
            truthBefore:
              Number(truthBefore.on_hand_quantity),
            truthCommitted:
              Number(truthCommitted.on_hand_quantity),
            t2StillBlockedAfterCommit:
              stillBlocked.rows[0].blocked,
          };

          // 5. Release the blocker, then let generation finish.
          releaseBlocker();
          await blockerPromise;

          outcome = await generationOutcome;
          bodyOk = true;
        } finally {
          releaseBlocker();

          if (blockerPromise) {
            await blockerPromise.catch(
              () => undefined
            );
          }

          if (generationOutcome) {
            await generationOutcome;
          }

          try {
            const residual =
              await coord.raw(
                `SELECT pid, locktype, mode, granted
                   FROM pg_locks
                  WHERE relation =
                          'external_product_identity_map'::regclass
                    AND pid <> pg_backend_pid()`
              );

            leakedLocks = residual.rows;
          } finally {
            await coord.destroy();
          }

          // eslint-disable-next-line no-console
          console.info(
            '[GH1179_D25_OBSERVED]',
            JSON.stringify({
              ...evidence,
              leakedLocks,
            })
          );

          if (bodyOk && leakedLocks.length > 0) {
            throw new Error(
              `[GH1179_D25_TEST] leaked identity locks: ${JSON.stringify(leakedLocks)}`
            );
          }
        }

        if (!outcome || !outcome.ok) {
          throw (outcome as any)?.error ??
            new Error(
              '[GH1179_D25_TEST] generation did not settle'
            );
        }

        const state =
          await generationState(
            fixture.shopId
          );

        expect(
          state.entries
        ).toHaveLength(1);

        expect(
          state.entries[0]
            .target_quantity
        ).toBe(3);

        expect(
          state.entries[0]
            .observed_on_hand_quantity
        ).toBe(8);

        const variables =
          parseJson(
            state.batches[0]
              .canonical_variables
          );

        expect(
          variables
            .input
            .quantities[0]
        ).toMatchObject({
          quantity:
            3,

          changeFromQuantity:
            8,
        });
      }
    );

  }
);
