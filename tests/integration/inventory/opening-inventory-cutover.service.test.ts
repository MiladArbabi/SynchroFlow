// GH-1179 RED-A: the warehouse → Shopify Location mapping route validates a
// new location against Shopify before persisting it. Only that provider
// client boundary is stubbed. Every existing cutover case injects its own
// executor or never reaches a provider call, so this mock is inert for them.
const mockShopifyRequest = jest.fn();

const mockCreateShopifyGraphQLClient = jest.fn(() => ({
  request: mockShopifyRequest,
}));

jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: (...args: any[]) =>
    mockCreateShopifyGraphQLClient(...args),
}));

import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { issueTestToken } from '../../unit/helpers/auth';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import {
  addOpeningInventoryRecountLine,
  claimRecountTask,
  completeOpeningInventoryBin,
  getShopOpeningInventoryProgress,
  recordCount,
} from 'api-src/services/wms/inventoryRecount.service';

import {
  startShopOpeningInventory,
  type OpeningInventoryLocationPageReader,
} from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';

import {
  approveAndRunOpeningInventoryCutover,
  executeOpeningInventoryCutover,
  getOpeningInventoryCutoverView,
  prepareOpeningInventoryCutover,
  type OpeningInventoryBatchExecutor,
  type OpeningInventoryShopifyInput,
} from 'api-src/services/wms/openingInventoryCutover.service';

jest.setTimeout(120000);

const REPO = path.resolve(__dirname, '../../..');

type Fixture = {
  shopId: number;
  warehouseId: string;
  rootCode: string;
  ownerId: number;
  adminId: number;
  operatorId: number;
  productId: string;
  variantId: string;
};

type FixtureOptions = {
  installation?: boolean;
  mappedLocation?: string | null;
  warehouseActive?: boolean;
};

function parseJson<T>(value: unknown): T {
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }

  return value as T;
}

async function createFixture(
  options: FixtureOptions = {}
): Promise<Fixture> {
  const unique = crypto.randomUUID().slice(0, 8);

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `opening-cutover-${unique}`
    );

    await setTenantContext(trx, id);
    return id;
  });

  return withTenant(shopId, async (trx) => {
    const users = await trx('users')
      .insert([
        {
          shop_id: shopId,
          email: `cut-owner-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'owner',
        },
        {
          shop_id: shopId,
          email: `cut-admin-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'admin',
        },
        {
          shop_id: shopId,
          email: `cut-operator-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'operator',
        },
      ])
      .returning(['id', 'role']);

    const ownerId = Number(
      users.find((row: any) => row.role === 'owner')!.id
    );

    const adminId = Number(
      users.find((row: any) => row.role === 'admin')!.id
    );

    const operatorId = Number(
      users.find((row: any) => row.role === 'operator')!.id
    );

    await trx('shop_memberships').insert([
      {
        shop_id: shopId,
        user_id: ownerId,
        role: 'owner',
      },
      {
        shop_id: shopId,
        user_id: adminId,
        role: 'admin',
      },
      {
        shop_id: shopId,
        user_id: operatorId,
        role: 'operator',
      },
    ]);

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model: 'reconcile_opening_expectation_v2',
    });

    const warehouseId = crypto.randomUUID();
    const rootCode = `CUT-${unique}-ROOT`;

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: `Cutover warehouse ${unique}`,
      root_location_code: rootCode,
      is_default: true,
      active: options.warehouseActive ?? true,
      external_location_id:
        options.mappedLocation === undefined
          ? `20${shopId}`
          : options.mappedLocation,
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
        location_code: `${unique}-A1`,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: `${unique}-A2`,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Opening cutover product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `CUT-${variantId.slice(0, 8)}`,
      title: 'Opening cutover variant',
      unit_cost: '1.00',
      status: 'active',
    });

    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shopId,
      platform: 'shopify',
      external_product_id:
        `gid://shopify/Product/${shopId}01`,
      external_variant_id:
        `gid://shopify/ProductVariant/${shopId}01`,
      external_inventory_item_id:
        `${shopId}001`,
      external_sku: `CUT-${variantId.slice(0, 8)}`,
    });

    if (options.installation !== false) {
      await trx('shopify_app_installations').insert({
        shop_id: shopId,
        shop_domain:
          `opening-cutover-${unique}.myshopify.com`,
        scopes: 'read_products,write_inventory',
      });
    }

    return {
      shopId,
      warehouseId,
      rootCode,
      ownerId,
      adminId,
      operatorId,
      productId,
      variantId,
    };
  });
}

async function seedExpectation(
  fixture: Fixture,
  expectedQuantity: number,
  params?: {
    variantId?: string;
    externalVariantId?: string;
  }
): Promise<void> {
  const variantId =
    params?.variantId ?? fixture.variantId;

  await withTenant(fixture.shopId, (trx) =>
    trx('shopify_opening_inventory_expectations').insert({
      shop_id: fixture.shopId,
      lasyncro_variant_id: variantId,
      external_variant_id:
        params?.externalVariantId ??
        `gid://shopify/ProductVariant/${variantId}`,
      reported_quantity: expectedQuantity,
      expected_quantity: expectedQuantity,
      observed_at: new Date(),
    })
  );
}

// GH-1179: start captures a location-scoped Shopify on_hand snapshot. These
// cutover contracts are not about that read, so the provider transport
// returns the frozen mapped Location as active with no inventory levels;
// reservation, validation and atomic finalize still run for real.
const emptyMappedLocationReader: OpeningInventoryLocationPageReader =
  async ({ variables }) => ({
    data: {
      location: {
        id: variables.locationId,
        isActive: true,
        inventoryLevels: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      },
    },
  });

async function startShop(fixture: Fixture) {
  return startShopOpeningInventory(
    {
      shopId: fixture.shopId,
      createdBy: fixture.ownerId,
      assignedTo: fixture.operatorId,
    },
    { readLocationPage: emptyMappedLocationReader }
  );
}

async function commitEmptyBin(
  fixture: Fixture,
  recountTaskId: string
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

async function settleAllEmpty(
  fixture: Fixture,
  bins: Array<{ recount_task_id: string }>
): Promise<void> {
  for (const bin of bins) {
    await commitEmptyBin(
      fixture,
      bin.recount_task_id
    );
  }
}

async function makeExactReady(
  fixture: Fixture
): Promise<void> {
  await seedExpectation(fixture, 0);

  const started = await startShop(fixture);

  await settleAllEmpty(
    fixture,
    started.bins
  );
}

async function makeNegativeReview(
  fixture: Fixture,
  expectedQuantity = 3
): Promise<void> {
  await seedExpectation(
    fixture,
    expectedQuantity
  );

  const started = await startShop(fixture);

  await settleAllEmpty(
    fixture,
    started.bins
  );
}

async function makePositiveReview(
  fixture: Fixture,
  physicalQuantity = 1
): Promise<void> {
  const started = await startShop(fixture);

  const first = started.bins[0];

  await withTenant(
    fixture.shopId,
    (trx) =>
      claimRecountTask(
        trx,
        fixture.shopId,
        first.recount_task_id,
        fixture.operatorId
      )
  );

  const line = await withTenant(
    fixture.shopId,
    (trx) =>
      addOpeningInventoryRecountLine(trx, {
        shopId: fixture.shopId,
        recountTaskId:
          first.recount_task_id,
        lasyncroVariantId:
          fixture.variantId,
        addedBy:
          fixture.operatorId,
      })
  );

  await withTenant(
    fixture.shopId,
    (trx) =>
      recordCount(trx, {
        shopId: fixture.shopId,
        recountTaskId:
          first.recount_task_id,
        recountLineId:
          line.recount_line_id,
        countedQuantity:
          physicalQuantity,
        countMethod: 'bin_quantity',
        countedBy:
          fixture.operatorId,
      })
  );

  await withTenant(
    fixture.shopId,
    (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        first.recount_task_id,
        fixture.operatorId
      )
  );

  for (const bin of started.bins.slice(1)) {
    await commitEmptyBin(
      fixture,
      bin.recount_task_id
    );
  }
}

async function addWarehouse(
  fixture: Fixture,
  params: {
    mappedLocation: string | null;
    active?: boolean;
  }
): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const warehouseId = crypto.randomUUID();
  const rootCode = `CUT-EXTRA-${suffix}`;

  await withTenant(
    fixture.shopId,
    async (trx) => {
      await trx('warehouses').insert({
        warehouse_id: warehouseId,
        shop_id: fixture.shopId,
        name: `Extra ${suffix}`,
        root_location_code: rootCode,
        is_default: false,
        active: params.active ?? true,
        external_location_id:
          params.mappedLocation,
      });

      await trx('warehouse_locations').insert({
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      });
    }
  );

  return warehouseId;
}

async function readCutover(
  shopId: number
): Promise<any> {
  return withTenant(
    shopId,
    (trx) =>
      trx('opening_inventory_cutovers')
        .where({ shop_id: shopId })
        .first()
  );
}

async function readBatches(
  shopId: number
): Promise<any[]> {
  return withTenant(
    shopId,
    (trx) =>
      trx('opening_inventory_cutover_batches')
        .where({ shop_id: shopId })
        .orderBy('batch_sequence', 'asc')
  );
}

async function readSyncedAt(
  shopId: number
): Promise<unknown> {
  const row = await withTenant(
    shopId,
    (trx) =>
      trx('shop_wms_settings')
        .where({ shop_id: shopId })
        .first(
          'opening_inventory_shopify_synced_at'
        )
  );

  return row?.opening_inventory_shopify_synced_at;
}

async function seedMismatchVariants(
  fixture: Fixture,
  count: number
): Promise<void> {
  if (count < 1) return;

  const extraCount = count - 1;

  const variants: any[] = [];
  const identities: any[] = [];
  const expectations: any[] = [];

  expectations.push({
    shop_id: fixture.shopId,
    lasyncro_variant_id:
      fixture.variantId,
    external_variant_id:
      `gid://shopify/ProductVariant/${fixture.shopId}0001`,
    reported_quantity: 1,
    expected_quantity: 1,
    observed_at: new Date(),
  });

  for (
    let index = 0;
    index < extraCount;
    index += 1
  ) {
    const variantId =
      crypto.randomUUID();

    const externalNumber =
      `${fixture.shopId}${String(
        index + 100
      ).padStart(5, '0')}`;

    variants.push({
      lasyncro_variant_id:
        variantId,
      lasyncro_product_id:
        fixture.productId,
      shop_id:
        fixture.shopId,
      sku:
        `CUT-BULK-${variantId.slice(0, 8)}`,
      title:
        `Cutover variant ${index}`,
      unit_cost: '1.00',
      status: 'active',
    });

    identities.push({
      id: crypto.randomUUID(),
      lasyncro_variant_id:
        variantId,
      shop_id:
        fixture.shopId,
      platform: 'shopify',
      external_product_id:
        `gid://shopify/Product/${fixture.shopId}01`,
      external_variant_id:
        `gid://shopify/ProductVariant/${externalNumber}`,
      external_inventory_item_id:
        externalNumber,
      external_sku:
        `CUT-BULK-${index}`,
    });

    expectations.push({
      shop_id:
        fixture.shopId,
      lasyncro_variant_id:
        variantId,
      external_variant_id:
        `gid://shopify/ProductVariant/${externalNumber}`,
      reported_quantity: 1,
      expected_quantity: 1,
      observed_at: new Date(),
    });
  }

  await withTenant(
    fixture.shopId,
    async (trx) => {
      if (variants.length > 0) {
        await trx('variants').insert(
          variants
        );

        await trx(
          'external_product_identity_map'
        ).insert(identities);
      }

      await trx(
        'shopify_opening_inventory_expectations'
      ).insert(expectations);
    }
  );

  const started =
    await startShop(fixture);

  await settleAllEmpty(
    fixture,
    started.bins
  );
}

describe(
  '4b-2b opening inventory cutover service contract',
  () => {
    it(
      'C01/C02 — operator and revoked approver cannot authorize cutover',
      async () => {
        const operatorFixture =
          await createFixture();

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              operatorFixture.shopId,
            actingUserId:
              operatorFixture.operatorId,
          })
        ).rejects.toThrow(
          /Only owner\/admin/
        );

        const revokedFixture =
          await createFixture();

        await withTenant(
          revokedFixture.shopId,
          (trx) =>
            trx('shop_memberships')
              .where({
                shop_id:
                  revokedFixture.shopId,
                user_id:
                  revokedFixture.ownerId,
              })
              .update({
                revoked_at:
                  trx.fn.now(),
              })
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              revokedFixture.shopId,
            actingUserId:
              revokedFixture.ownerId,
          })
        ).rejects.toThrow(
          /Active shop membership required/
        );
      }
    );

    it(
      'C03/C04/C07/C08/C45 — owner/admin exact-match approval passes authorization without mismatch acceptance, but legacy zero difference fails closed with no Shopify write (GH-1179)',
      async () => {
        for (const role of [
          'owner',
          'admin',
        ] as const) {
          // GH-1179: Opening Inventory now requires a mapped warehouse to
          // start, and a zero difference against the legacy aggregate
          // expectation no longer certifies the Shopify sync. Owner/admin
          // authority and "no acceptance demanded at exact match" are
          // retained: rejection comes from scoped provenance, not from the
          // role or acceptance gates.
          const fixture =
            await createFixture({
              installation: false,
            });

          await makeExactReady(
            fixture
          );

          const actingUserId =
            role === 'owner'
              ? fixture.ownerId
              : fixture.adminId;

          const executorCalls: unknown[] = [];

          await expect(
            approveAndRunOpeningInventoryCutover(
              {
                shopId:
                  fixture.shopId,
                actingUserId,
                executor: async (params) => {
                  executorCalls.push(params);
                  throw new Error(
                    '[GH1179_TEST] provider executor must not be reached'
                  );
                },
              }
            )
          ).rejects.toThrow(
            /^\[OPENING_CUTOVER_PREFLIGHT\]/
          );

          expect(executorCalls).toHaveLength(0);

          expect(
            await readCutover(
              fixture.shopId
            )
          ).toBeUndefined();

          expect(
            await readBatches(
              fixture.shopId
            )
          ).toHaveLength(0);

          expect(
            await readSyncedAt(
              fixture.shopId
            )
          ).toBeNull();
        }
      }
    );

    it(
      'C05/C06 — counting and unresolved bin-review states reject approval',
      async () => {
        const counting =
          await createFixture();

        await seedExpectation(
          counting,
          0
        );

        await startShop(
          counting
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              counting.shopId,
            actingUserId:
              counting.ownerId,
          })
        ).rejects.toThrow(
          /state is counting/
        );

        const review =
          await createFixture();

        await seedExpectation(
          review,
          0
        );

        const started =
          await startShop(review);

        await withTenant(
          review.shopId,
          (trx) =>
            trx(
              'inventory_recount_tasks'
            )
              .where({
                shop_id:
                  review.shopId,
                recount_task_id:
                  started.bins[0]
                    .recount_task_id,
              })
              .update({
                status:
                  'manual_review',
                updated_at:
                  trx.fn.now(),
              })
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              review.shopId,
            actingUserId:
              review.ownerId,
          })
        ).rejects.toThrow(
          /needs_bin_review/
        );
      }
    );

    it(
      'C10/C11/C12/C13/C14 — mismatch requires acceptance and freezes observed-minus-expected delta',
      async () => {
        const negative =
          await createFixture();

        await makeNegativeReview(
          negative,
          3
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              negative.shopId,
            actingUserId:
              negative.ownerId,
            acceptPhysicalTruth:
              false,
          })
        ).rejects.toThrow(
          /ACCEPTANCE_REQUIRED/
        );

        const negativeCutover =
          await prepareOpeningInventoryCutover(
            {
              shopId:
                negative.shopId,
              actingUserId:
                negative.ownerId,
              acceptPhysicalTruth:
                true,
            }
          );

        expect(
          negativeCutover.status
        ).toBe('prepared');

        expect(
          negativeCutover.physical_truth_accepted_at
        ).toBeTruthy();

        const negativeInput =
          parseJson<OpeningInventoryShopifyInput>(
            (
              await readBatches(
                negative.shopId
              )
            )[0].shopify_input
          );

        expect(
          negativeInput.changes[0].delta
        ).toBe(-3);

        const positive =
          await createFixture();

        await makePositiveReview(
          positive,
          2
        );

        const positiveCutover =
          await prepareOpeningInventoryCutover(
            {
              shopId:
                positive.shopId,
              actingUserId:
                positive.ownerId,
              acceptPhysicalTruth:
                true,
            }
          );

        expect(
          positiveCutover.status
        ).toBe('prepared');

        const positiveInput =
          parseJson<OpeningInventoryShopifyInput>(
            (
              await readBatches(
                positive.shopId
              )
            )[0].shopify_input
          );

        expect(
          positiveInput.changes[0].delta
        ).toBe(2);
      }
    );

    it(
      'C16/C17/C18/C19 — nonzero aggregate correction requires exactly one active fully-mapped warehouse',
      async () => {
        const one =
          await createFixture();

        await makeNegativeReview(
          one
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId: one.shopId,
            actingUserId:
              one.ownerId,
            acceptPhysicalTruth:
              true,
          })
        ).resolves.toMatchObject({
          status: 'prepared',
        });

        const unmapped =
          await createFixture();

        await makeNegativeReview(
          unmapped
        );

        await withTenant(
          unmapped.shopId,
          (trx) =>
            trx('warehouses')
              .where({
                shop_id:
                  unmapped.shopId,
                warehouse_id:
                  unmapped.warehouseId,
              })
              .update({
                external_location_id:
                  null,
              })
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              unmapped.shopId,
            actingUserId:
              unmapped.ownerId,
            acceptPhysicalTruth:
              true,
          })
        ).rejects.toThrow(
          /Every active warehouse must have/
        );

        const inactive =
          await createFixture();

        await makeNegativeReview(
          inactive
        );

        await withTenant(
          inactive.shopId,
          (trx) =>
            trx('warehouses')
              .where({
                shop_id:
                  inactive.shopId,
                warehouse_id:
                  inactive.warehouseId,
              })
              .update({
                active: false,
              })
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              inactive.shopId,
            actingUserId:
              inactive.ownerId,
            acceptPhysicalTruth:
              true,
          })
        ).rejects.toThrow(
          /No active warehouse/
        );

        const multiple =
          await createFixture();

        await makeNegativeReview(
          multiple
        );

        await addWarehouse(
          multiple,
          {
            mappedLocation:
              '999999',
          }
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              multiple.shopId,
            actingUserId:
              multiple.ownerId,
            acceptPhysicalTruth:
              true,
          })
        ).rejects.toThrow(
          /Multiple active mapped/
        );

        const mixed =
          await createFixture();

        await makeNegativeReview(
          mixed
        );

        await addWarehouse(
          mixed,
          {
            mappedLocation: null,
          }
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              mixed.shopId,
            actingUserId:
              mixed.ownerId,
            acceptPhysicalTruth:
              true,
          })
        ).rejects.toThrow(
          /Every active warehouse must have/
        );
      }
    );

    it(
      'C20/C22 — required correction fails closed on missing Shopify installation or item identity',
      async () => {
        const noInstall =
          await createFixture({
            installation: false,
          });

        await makeNegativeReview(
          noInstall
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              noInstall.shopId,
            actingUserId:
              noInstall.ownerId,
            acceptPhysicalTruth:
              true,
          })
        ).rejects.toThrow(
          /Shopify installation missing/
        );

        const noIdentity =
          await createFixture();

        await makeNegativeReview(
          noIdentity
        );

        await withTenant(
          noIdentity.shopId,
          (trx) =>
            trx(
              'external_product_identity_map'
            )
              .where({
                shop_id:
                  noIdentity.shopId,
              })
              .del()
        );

        await expect(
          prepareOpeningInventoryCutover({
            shopId:
              noIdentity.shopId,
            actingUserId:
              noIdentity.ownerId,
            acceptPhysicalTruth:
              true,
          })
        ).rejects.toThrow(
          /Missing Shopify inventory item/
        );
      }
    );

    it(
      'C23/C24/C25/C26/C27 — 250/251 boundary freezes provider-safe correction payloads',
      async () => {
        const f250 =
          await createFixture();

        await seedMismatchVariants(
          f250,
          250
        );

        const c250 =
          await prepareOpeningInventoryCutover(
            {
              shopId:
                f250.shopId,
              actingUserId:
                f250.ownerId,
              acceptPhysicalTruth:
                true,
            }
          );

        expect(
          c250.correction_variant_count
        ).toBe(250);

        expect(
          c250.batch_count
        ).toBe(1);

        const b250 =
          await readBatches(
            f250.shopId
          );

        const input250 =
          parseJson<OpeningInventoryShopifyInput>(
            b250[0].shopify_input
          );

        const audit250 =
          parseJson<any[]>(
            b250[0].audit_snapshot
          );

        expect(
          input250.reason
        ).toBe('correction');

        expect(
          input250.name
        ).toBe('available');

        expect(
          input250.changes
        ).toHaveLength(250);

        expect(
          audit250
        ).toHaveLength(250);

        expect(
          input250.changes.every(
            (change) =>
              change.changeFromQuantity ===
              null
          )
        ).toBe(true);

        const f251 =
          await createFixture();

        await seedMismatchVariants(
          f251,
          251
        );

        const c251 =
          await prepareOpeningInventoryCutover(
            {
              shopId:
                f251.shopId,
              actingUserId:
                f251.ownerId,
              acceptPhysicalTruth:
                true,
            }
          );

        expect(
          c251.batch_count
        ).toBe(2);

        const b251 =
          await readBatches(
            f251.shopId
          );

        expect(
          parseJson<OpeningInventoryShopifyInput>(
            b251[0].shopify_input
          ).changes
        ).toHaveLength(250);

        expect(
          parseJson<OpeningInventoryShopifyInput>(
            b251[1].shopify_input
          ).changes
        ).toHaveLength(1);
      }
    );

    it(
      'C28/C29/C30/C43/C44 — execution reads persisted payload and only confirmed success completes readiness',
      async () => {
        const fixture =
          await createFixture();

        await makeNegativeReview(
          fixture,
          4
        );

        const prepared =
          await prepareOpeningInventoryCutover(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            }
          );

        const persisted =
          (
            await readBatches(
              fixture.shopId
            )
          )[0];

        const persistedInput =
          parseJson<OpeningInventoryShopifyInput>(
            persisted.shopify_input
          );

        await withTenant(
          fixture.shopId,
          async (trx) => {
            await trx(
              'external_product_identity_map'
            )
              .where({
                shop_id:
                  fixture.shopId,
                lasyncro_variant_id:
                  fixture.variantId,
              })
              .update({
                external_inventory_item_id:
                  `${fixture.shopId}99999`,
              });

            await trx('warehouses')
              .where({
                shop_id:
                  fixture.shopId,
                warehouse_id:
                  fixture.warehouseId,
              })
              .update({
                external_location_id:
                  '888888',
              });
          }
        );

        const calls: any[] = [];

        const executor: OpeningInventoryBatchExecutor =
          async (input) => {
            calls.push(input);

            return {
              adjustmentGroupId:
                'gid://shopify/InventoryAdjustmentGroup/confirmed-1',
            };
          };

        const result =
          await executeOpeningInventoryCutover(
            {
              shopId:
                fixture.shopId,
              executor,
            }
          );

        expect(calls).toHaveLength(1);

        expect(
          calls[0].idempotencyKey
        ).toBe(
          persisted.idempotency_key
        );

        expect(
          calls[0].shopifyInput
        ).toEqual(persistedInput);

        expect(
          calls[0].shopifyInput.changes[0]
            .inventoryItemId
        ).not.toContain('99999');

        expect(
          calls[0].shopifyInput.changes[0]
            .locationId
        ).not.toContain('888888');

        expect(
          result.cutover_id
        ).toBe(prepared.cutover_id);

        expect(
          result.status
        ).toBe('complete');

        const batch =
          (
            await readBatches(
              fixture.shopId
            )
          )[0];

        expect(
          batch.status
        ).toBe('succeeded');

        expect(
          batch.shopify_adjustment_group_id
        ).toBe(
          'gid://shopify/InventoryAdjustmentGroup/confirmed-1'
        );

        expect(
          await readSyncedAt(
            fixture.shopId
          )
        ).toBeTruthy();
      }
    );

    it(
      'C31/C32/C33/C34/C41/C42 — failed/unknown outcomes remain incomplete and retry exact same operation',
      async () => {
        for (const failure of [
          new Error(
            'Shopify userErrors: controlled'
          ),
          new Error(
            'transport timeout after send'
          ),
        ]) {
          const fixture =
            await createFixture();

          await makeNegativeReview(
            fixture,
            5
          );

          await prepareOpeningInventoryCutover(
            {
              shopId:
                fixture.shopId,
              actingUserId:
                fixture.ownerId,
              acceptPhysicalTruth:
                true,
            }
          );

          const firstCalls: any[] =
            [];

          await expect(
            executeOpeningInventoryCutover(
              {
                shopId:
                  fixture.shopId,
                executor:
                  async (input) => {
                    firstCalls.push(
                      input
                    );
                    throw failure;
                  },
              }
            )
          ).rejects.toThrow();

          const failedCutover =
            await readCutover(
              fixture.shopId
            );

          const failedBatch =
            (
              await readBatches(
                fixture.shopId
              )
            )[0];

          expect(
            failedCutover.status
          ).toBe('failed');

          expect(
            failedBatch.status
          ).toBe('failed');

          expect(
            failedBatch.attempt_count
          ).toBe(1);

          expect(
            await readSyncedAt(
              fixture.shopId
            )
          ).toBeNull();

          const retryCalls: any[] =
            [];

          const completed =
            await executeOpeningInventoryCutover(
              {
                shopId:
                  fixture.shopId,
                executor:
                  async (input) => {
                    retryCalls.push(
                      input
                    );

                    return {
                      adjustmentGroupId:
                        'gid://shopify/InventoryAdjustmentGroup/retry-ok',
                    };
                  },
              }
            );

          expect(
            retryCalls
          ).toHaveLength(1);

          expect(
            retryCalls[0]
              .idempotencyKey
          ).toBe(
            firstCalls[0]
              .idempotencyKey
          );

          expect(
            retryCalls[0]
              .shopifyInput
          ).toEqual(
            firstCalls[0]
              .shopifyInput
          );

          const retriedBatch =
            (
              await readBatches(
                fixture.shopId
              )
            )[0];

          expect(
            retriedBatch.attempt_count
          ).toBe(2);

          expect(
            completed.status
          ).toBe('complete');
        }
      }
    );

    it(
      'C35/C36 — partial retry skips confirmed batch and resumes only incomplete work',
      async () => {
        const fixture =
          await createFixture();

        await seedMismatchVariants(
          fixture,
          251
        );

        await prepareOpeningInventoryCutover(
          {
            shopId:
              fixture.shopId,
            actingUserId:
              fixture.ownerId,
            acceptPhysicalTruth:
              true,
          }
        );

        let firstRunCalls = 0;

        await expect(
          executeOpeningInventoryCutover(
            {
              shopId:
                fixture.shopId,
              executor:
                async () => {
                  firstRunCalls += 1;

                  if (
                    firstRunCalls === 2
                  ) {
                    throw new Error(
                      'second batch controlled failure'
                    );
                  }

                  return {
                    adjustmentGroupId:
                      'gid://shopify/InventoryAdjustmentGroup/batch-1',
                  };
                },
            }
          )
        ).rejects.toThrow(
          /second batch/
        );

        const afterFailure =
          await readBatches(
            fixture.shopId
          );

        expect(
          afterFailure.map(
            (row) => row.status
          )
        ).toEqual([
          'succeeded',
          'failed',
        ]);

        const retryCalls: any[] =
          [];

        const completed =
          await executeOpeningInventoryCutover(
            {
              shopId:
                fixture.shopId,
              executor:
                async (input) => {
                  retryCalls.push(input);

                  return {
                    adjustmentGroupId:
                      'gid://shopify/InventoryAdjustmentGroup/batch-2',
                  };
                },
            }
          );

        expect(
          retryCalls
        ).toHaveLength(1);

        expect(
          retryCalls[0]
            .idempotencyKey
        ).toMatch(/:2$/);

        const finalBatches =
          await readBatches(
            fixture.shopId
          );

        expect(
          finalBatches[0]
            .attempt_count
        ).toBe(1);

        expect(
          finalBatches[1]
            .attempt_count
        ).toBe(2);

        expect(
          completed.status
        ).toBe('complete');
      }
    );

    it(
      'GRILL-01 — stale in_flight batch reclaims the exact persisted economic operation',
      async () => {
        const fixture =
          await createFixture();

        await makeNegativeReview(
          fixture,
          3
        );

        await prepareOpeningInventoryCutover(
          {
            shopId:
              fixture.shopId,
            actingUserId:
              fixture.ownerId,
            acceptPhysicalTruth:
              true,
          }
        );

        const before =
          (
            await readBatches(
              fixture.shopId
            )
          )[0];

        expect(before.status).toBe(
          'pending'
        );

        await withTenant(
          fixture.shopId,
          (trx) =>
            trx(
              'opening_inventory_cutover_batches'
            )
              .where({
                shop_id:
                  fixture.shopId,
                batch_sequence: 1,
              })
              .update({
                status:
                  'in_flight',
                attempt_count: 1,
                last_attempted_at:
                  trx.fn.now(),
                updated_at:
                  trx.fn.now(),
              })
        );

        const calls: any[] = [];

        const completed =
          await executeOpeningInventoryCutover(
            {
              shopId:
                fixture.shopId,
              executor:
                async (input) => {
                  calls.push(input);

                  return {
                    adjustmentGroupId:
                      'gid://shopify/InventoryAdjustmentGroup/grill-stale-recovery',
                  };
                },
            }
          );

        expect(calls).toHaveLength(1);

        expect(
          calls[0].idempotencyKey
        ).toBe(
          before.idempotency_key
        );

        const frozenInput =
          typeof before.shopify_input ===
          'string'
            ? JSON.parse(
                before.shopify_input
              )
            : before.shopify_input;

        expect(
          calls[0].shopifyInput
        ).toEqual(
          frozenInput
        );

        const after =
          (
            await readBatches(
              fixture.shopId
            )
          )[0];

        expect(after.status).toBe(
          'succeeded'
        );

        expect(
          Number(
            after.attempt_count
          )
        ).toBe(2);

        expect(
          completed.status
        ).toBe('complete');
      }
    );

    it(
      'GRILL-02 — stale concurrent failure cannot regress parent after that batch succeeded',
      async () => {
        const fixture =
          await createFixture();

        await seedMismatchVariants(
          fixture,
          251
        );

        await prepareOpeningInventoryCutover(
          {
            shopId:
              fixture.shopId,
            actingUserId:
              fixture.ownerId,
            acceptPhysicalTruth:
              true,
          }
        );

        let releaseExecutorA:
          (() => void) | undefined;

        let markExecutorAStarted:
          (() => void) | undefined;

        let releaseExecutorBSecond:
          (() => void) | undefined;

        let markExecutorBSecondStarted:
          (() => void) | undefined;

        const executorAStarted =
          new Promise<void>(
            (resolve) => {
              markExecutorAStarted =
                resolve;
            }
          );

        const holdExecutorA =
          new Promise<void>(
            (resolve) => {
              releaseExecutorA =
                resolve;
            }
          );

        const executorBSecondStarted =
          new Promise<void>(
            (resolve) => {
              markExecutorBSecondStarted =
                resolve;
            }
          );

        const holdExecutorBSecond =
          new Promise<void>(
            (resolve) => {
              releaseExecutorBSecond =
                resolve;
            }
          );

        const executionA =
          executeOpeningInventoryCutover(
            {
              shopId:
                fixture.shopId,
              executor:
                async () => {
                  markExecutorAStarted?.();

                  await holdExecutorA;

                  throw new Error(
                    'GRILL stale executor A failure'
                  );
                },
            }
          );

        await executorAStarted;

        let executorBCalls = 0;

        const executionB =
          executeOpeningInventoryCutover(
            {
              shopId:
                fixture.shopId,
              executor:
                async () => {
                  executorBCalls += 1;

                  if (
                    executorBCalls === 2
                  ) {
                    markExecutorBSecondStarted?.();

                    await holdExecutorBSecond;
                  }

                  return {
                    adjustmentGroupId:
                      `gid://shopify/InventoryAdjustmentGroup/grill-b-${executorBCalls}`,
                  };
                },
            }
          );

        await executorBSecondStarted;

        releaseExecutorA?.();

        await expect(
          executionA
        ).rejects.toThrow(
          /stale executor A failure/
        );

        /**
         * Executor B has already persisted batch 1 as succeeded but is paused
         * in batch 2. The stale failure from A must not regress the parent.
         */
        const duringRace =
          await withTenant(
            fixture.shopId,
            (trx) =>
              trx(
                'opening_inventory_cutovers'
              )
                .where({
                  shop_id:
                    fixture.shopId,
                })
                .select(
                  'status',
                  'last_error'
                )
                .first()
          );

        expect(
          duringRace.status
        ).toBe('executing');

        expect(
          duringRace.last_error
        ).toBeNull();

        const batchesDuringRace =
          await readBatches(
            fixture.shopId
          );

        expect(
          batchesDuringRace.map(
            (row) => row.status
          )
        ).toEqual([
          'succeeded',
          'in_flight',
        ]);

        releaseExecutorBSecond?.();

        const completed =
          await executionB;

        expect(
          completed.status
        ).toBe('complete');

        const finalBatches =
          await readBatches(
            fixture.shopId
          );

        expect(
          finalBatches.map(
            (row) => row.status
          )
        ).toEqual([
          'succeeded',
          'succeeded',
        ]);
      }
    );

    it(
      'C37/C38 — concurrent/repeated approval resolves to the same one-time cutover',
      async () => {
        const fixture =
          await createFixture();

        await makeNegativeReview(
          fixture,
          3
        );

        const params = {
          shopId: fixture.shopId,
          actingUserId:
            fixture.ownerId,
          acceptPhysicalTruth: true,
        };

        const [a, b] =
          await Promise.all([
            prepareOpeningInventoryCutover(
              params
            ),
            prepareOpeningInventoryCutover(
              params
            ),
          ]);

        expect(
          a.cutover_id
        ).toBe(b.cutover_id);

        const rows =
          await withTenant(
            fixture.shopId,
            (trx) =>
              trx(
                'opening_inventory_cutovers'
              ).where({
                shop_id:
                  fixture.shopId,
              })
          );

        expect(rows).toHaveLength(1);

        const executor =
          jest.fn(async () => ({
            adjustmentGroupId:
              'gid://shopify/InventoryAdjustmentGroup/once',
          }));

        await executeOpeningInventoryCutover(
          {
            shopId:
              fixture.shopId,
            executor,
          }
        );

        const afterComplete =
          await approveAndRunOpeningInventoryCutover(
            {
              ...params,
              executor,
            }
          );

        expect(
          afterComplete.cutover_id
        ).toBe(a.cutover_id);

        expect(
          executor
        ).toHaveBeenCalledTimes(1);
      }
    );

    it(
      'C09/C39/C40 — approval mutates neither opening movements nor current physical projection',
      async () => {
        const fixture =
          await createFixture();

        await makePositiveReview(
          fixture,
          2
        );

        const beforeMovements =
          await withTenant(
            fixture.shopId,
            (trx) =>
              trx(
                'inventory_movements'
              )
                .where({
                  shop_id:
                    fixture.shopId,
                  movement_type:
                    'opening_inventory_reconcile',
                })
                .select('*')
                .orderBy(
                  'lasyncro_inventory_movement_id'
                )
          );

        const beforeTruth =
          await withTenant(
            fixture.shopId,
            (trx) =>
              trx(
                'inventory_truth'
              )
                .where({
                  shop_id:
                    fixture.shopId,
                })
                .select('*')
                .orderBy([
                  {
                    column:
                      'lasyncro_variant_id',
                    order: 'asc',
                  },
                  {
                    column:
                      'location_code',
                    order: 'asc',
                  },
                ])
          );

        await prepareOpeningInventoryCutover(
          {
            shopId:
              fixture.shopId,
            actingUserId:
              fixture.ownerId,
            acceptPhysicalTruth:
              true,
          }
        );

        const afterMovements =
          await withTenant(
            fixture.shopId,
            (trx) =>
              trx(
                'inventory_movements'
              )
                .where({
                  shop_id:
                    fixture.shopId,
                  movement_type:
                    'opening_inventory_reconcile',
                })
                .select('*')
                .orderBy(
                  'lasyncro_inventory_movement_id'
                )
          );

        const afterTruth =
          await withTenant(
            fixture.shopId,
            (trx) =>
              trx(
                'inventory_truth'
              )
                .where({
                  shop_id:
                    fixture.shopId,
                })
                .select('*')
                .orderBy([
                  {
                    column:
                      'lasyncro_variant_id',
                    order: 'asc',
                  },
                  {
                    column:
                      'location_code',
                    order: 'asc',
                  },
                ])
          );

        expect(
          afterMovements
        ).toEqual(beforeMovements);

        expect(
          afterTruth
        ).toEqual(beforeTruth);
      }
    );

    it(
      'C46 — cutover cannot complete while any required batch remains failed or pending',
      async () => {
        const fixture =
          await createFixture();

        await seedMismatchVariants(
          fixture,
          251
        );

        await prepareOpeningInventoryCutover(
          {
            shopId:
              fixture.shopId,
            actingUserId:
              fixture.ownerId,
            acceptPhysicalTruth:
              true,
          }
        );

        await expect(
          executeOpeningInventoryCutover(
            {
              shopId:
                fixture.shopId,
              executor:
                async () => {
                  throw new Error(
                    'stop first batch'
                  );
                },
            }
          )
        ).rejects.toThrow();

        const batches =
          await readBatches(
            fixture.shopId
          );

        expect(
          batches.map(
            (row) => row.status
          )
        ).toEqual([
          'failed',
          'pending',
        ]);

        expect(
          (
            await readCutover(
              fixture.shopId
            )
          ).status
        ).not.toBe('complete');

        expect(
          await readSyncedAt(
            fixture.shopId
          )
        ).toBeNull();
      }
    );

    it(
      'C15/C47/C48 — economic execution is frozen-delta only and contains no absolute/current-capacity authority',
      async () => {
        const serviceSource =
          fs.readFileSync(
            path.join(
              REPO,
              'apps/backend/src/services/wms/openingInventoryCutover.service.ts'
            ),
            'utf8'
          );

        const shopifySource =
          fs.readFileSync(
            path.join(
              REPO,
              'apps/backend/src/services/wms/shopifyOpeningInventoryCutover.service.ts'
            ),
            'utf8'
          );

        expect(
          serviceSource
        ).not.toMatch(
          /\binventory_truth\b/
        );

        expect(
          serviceSource
        ).not.toMatch(
          /\bavailable_quantity\b/
        );

        expect(
          serviceSource
        ).not.toMatch(
          /\binventorySetQuantities\b/
        );

        expect(
          shopifySource
        ).not.toMatch(
          /\binventorySetQuantities\b/
        );

        expect(
          shopifySource
        ).toMatch(
          /inventoryAdjustQuantities/
        );

        expect(
          shopifySource
        ).toMatch(
          /@idempotent\(key: \$idempotencyKey\)/
        );

        expect(
          serviceSource
        ).toMatch(
          /difference\.delta/
        );

        expect(
          serviceSource
        ).toMatch(
          /batch\.shopify_input/
        );
      }
    );
  }
);

async function readInventoryState(
  shopId: number
): Promise<{ movements: any[]; truth: any[] }> {
  return withTenant(shopId, async (trx) => ({
    movements: await trx('inventory_movements')
      .where({ shop_id: shopId })
      .select('*')
      .orderBy('lasyncro_inventory_movement_id'),
    truth: await trx('inventory_truth')
      .where({ shop_id: shopId })
      .select('*')
      .orderBy([
        { column: 'lasyncro_variant_id', order: 'asc' },
        { column: 'location_code', order: 'asc' },
      ]),
  }));
}

describe(
  'GRILL-03F-DB — getOpeningInventoryCutoverView real-Postgres read model',
  () => {
    it(
      'GRILL-03F-DB1 — before cutover: canonical progress, no cutover, no sync marker',
      async () => {
        const fixture = await createFixture();

        await makeNegativeReview(fixture, 3);

        const canonical = await withTenant(
          fixture.shopId,
          (trx) =>
            getShopOpeningInventoryProgress(
              trx,
              fixture.shopId
            )
        );

        const view =
          await getOpeningInventoryCutoverView(
            fixture.shopId
          );

        expect(canonical.state).toBe(
          'review_required'
        );
        expect(view.progress).toEqual(
          canonical
        );
        expect(view.cutover).toBeNull();
        expect(
          view.shopify_synced_at
        ).toBeNull();
        expect(
          await readCutover(fixture.shopId)
        ).toBeUndefined();
      }
    );

    it(
      'GRILL-03F-DB2 — prepared/executing status and persisted acceptance reflected; read mutates nothing',
      async () => {
        const fixture = await createFixture();

        await makeNegativeReview(fixture, 3);

        await prepareOpeningInventoryCutover({
          shopId: fixture.shopId,
          actingUserId: fixture.ownerId,
          acceptPhysicalTruth: true,
        });

        const inventoryBefore =
          await readInventoryState(
            fixture.shopId
          );
        const cutoverBefore =
          await readCutover(fixture.shopId);
        const batchesBefore =
          await readBatches(fixture.shopId);

        const prepared =
          await getOpeningInventoryCutoverView(
            fixture.shopId
          );

        // Read is side-effect free: inventory, cutover and batches unchanged.
        await getOpeningInventoryCutoverView(
          fixture.shopId
        );

        expect(
          await readInventoryState(
            fixture.shopId
          )
        ).toEqual(inventoryBefore);
        expect(
          await readCutover(fixture.shopId)
        ).toEqual(cutoverBefore);
        expect(
          await readBatches(fixture.shopId)
        ).toEqual(batchesBefore);

        expect(prepared.cutover).toEqual({
          status: 'prepared',
          physical_truth_accepted: true,
          error_code: null,
          error_message: null,
          completed_at: null,
        });
        expect(
          cutoverBefore.physical_truth_accepted_at
        ).not.toBeNull();
        expect(
          prepared.shopify_synced_at
        ).toBeNull();

        let duringExecution:
          | Awaited<
              ReturnType<
                typeof getOpeningInventoryCutoverView
              >
            >
          | undefined;

        const inventoryBeforeExecution =
          await readInventoryState(
            fixture.shopId
          );

        await executeOpeningInventoryCutover({
          shopId: fixture.shopId,
          executor: async () => {
            duringExecution =
              await getOpeningInventoryCutoverView(
                fixture.shopId
              );

            return {
              adjustmentGroupId:
                'gid://shopify/InventoryAdjustmentGroup/grill-03f-db2',
            };
          },
        });

        expect(
          duringExecution?.cutover
        ).toEqual({
          status: 'executing',
          physical_truth_accepted: true,
          error_code: null,
          error_message: null,
          completed_at: null,
        });
        expect(
          duringExecution?.shopify_synced_at
        ).toBeNull();

        // Neither the read nor the Shopify-side cutover touches the ledger
        // or physical projection.
        expect(
          await readInventoryState(
            fixture.shopId
          )
        ).toEqual(inventoryBeforeExecution);
      }
    );

    it(
      'GRILL-03F-DB3 / GRILL-03H / GRILL-03I — raw persisted last_error retained in DB, sanitized in the read model',
      async () => {
        const fixture = await createFixture();

        await makeNegativeReview(fixture, 3);

        await prepareOpeningInventoryCutover({
          shopId: fixture.shopId,
          actingUserId: fixture.ownerId,
          acceptPhysicalTruth: true,
        });

        const rawInternal =
          'socket ECONNRESET secret-internal-detail';

        await expect(
          executeOpeningInventoryCutover({
            shopId: fixture.shopId,
            executor: async () => {
              throw new Error(rawInternal);
            },
          })
        ).rejects.toThrow(rawInternal);

        const failedRow =
          await readCutover(fixture.shopId);

        expect(failedRow.status).toBe(
          'failed'
        );
        expect(failedRow.last_error).toBe(
          rawInternal
        );

        const internalView =
          await getOpeningInventoryCutoverView(
            fixture.shopId
          );

        expect(
          internalView.cutover?.status
        ).toBe('failed');
        expect(
          internalView.cutover?.physical_truth_accepted
        ).toBe(true);
        expect(
          internalView.cutover?.error_code
        ).toBe('OPENING_CUTOVER_INTERNAL');
        expect(
          typeof internalView.cutover?.error_message
        ).toBe('string');
        expect(
          JSON.stringify(internalView)
        ).not.toContain(
          'secret-internal-detail'
        );
        expect(
          JSON.stringify(internalView)
        ).not.toContain('ECONNRESET');
        expect(
          internalView.cutover
        ).not.toHaveProperty('last_error');

        const rawShopify =
          '[OPENING_CUTOVER_SHOPIFY] userErrors: [{"message":"secret-provider-detail"}]';

        await expect(
          executeOpeningInventoryCutover({
            shopId: fixture.shopId,
            executor: async () => {
              throw new Error(rawShopify);
            },
          })
        ).rejects.toThrow(
          'secret-provider-detail'
        );

        expect(
          (await readCutover(fixture.shopId))
            .last_error
        ).toBe(rawShopify);

        const shopifyView =
          await getOpeningInventoryCutoverView(
            fixture.shopId
          );

        expect(
          shopifyView.cutover?.error_code
        ).toBe('OPENING_CUTOVER_SHOPIFY');
        expect(
          shopifyView.cutover?.error_message
        ).toEqual(expect.any(String));
        expect(
          JSON.stringify(shopifyView)
        ).not.toContain(
          'secret-provider-detail'
        );
        expect(
          JSON.stringify(shopifyView)
        ).not.toContain(
          '[OPENING_CUTOVER_SHOPIFY]'
        );
      }
    );

    it(
      'GRILL-03F-DB4 — complete cutover reflects complete status and the persisted Shopify sync marker',
      async () => {
        // GH-1179: the legacy zero-difference shortcut no longer completes a
        // cutover. The read-model contract (complete status + persisted sync
        // marker) is exercised through the confirmed-execution completion
        // path instead, as C28 does. That path is itself due for replacement
        // by the scoped snapshot/attempt slices.
        const fixture = await createFixture();

        await makeNegativeReview(fixture, 4);

        await approveAndRunOpeningInventoryCutover({
          shopId: fixture.shopId,
          actingUserId: fixture.ownerId,
          acceptPhysicalTruth: true,
          executor: async () => ({
            adjustmentGroupId:
              'gid://shopify/InventoryAdjustmentGroup/db4-confirmed',
          }),
        });

        const persistedSyncedAt =
          await readSyncedAt(fixture.shopId);
        const row =
          await readCutover(fixture.shopId);

        expect(persistedSyncedAt).toBeTruthy();

        const view =
          await getOpeningInventoryCutoverView(
            fixture.shopId
          );

        expect(view.cutover).toEqual({
          status: 'complete',
          physical_truth_accepted: true,
          error_code: null,
          error_message: null,
          completed_at: new Date(
            row.completed_at
          ),
        });
        expect(
          view.shopify_synced_at
        ).toEqual(
          new Date(
            persistedSyncedAt as string
          )
        );
      }
    );
  }
);

describe('GRILL-05 — real WMS route + middleware + Postgres cutover proof', () => {
  const app = createApp();

  async function enableHttpAccess(
    fixture: Fixture,
    userId: number,
    role: 'owner' | 'admin' | 'operator'
  ): Promise<string> {
    await withTenant(
      fixture.shopId,
      async (trx) => {
        const membership =
          await trx('shop_memberships')
            .where({
              shop_id: fixture.shopId,
              user_id: userId,
            })
            .first();

        if (membership) {
          await trx('shop_memberships')
            .where({
              shop_id: fixture.shopId,
              user_id: userId,
            })
            .update({ role });
        } else {
          await trx('shop_memberships').insert({
            shop_id: fixture.shopId,
            user_id: userId,
            role,
          });
        }

        await trx('user_lifecycle_snapshot')
          .where({
            shop_id: fixture.shopId,
            user_id: userId,
          })
          .del();

        await trx('user_lifecycle_snapshot').insert({
          shop_id: fixture.shopId,
          user_id: userId,
          phase: 'FT2',
          since: new Date(),
          last_event_id: crypto.randomUUID(),
        });
      }
    );

    await withTenant(
      fixture.shopId,
      (trx) =>
        transitionShopSubscription(
          {
            shopId: fixture.shopId,
            to: {
              tier: 'core',
              status: 'active',
              billingProvider: 'shopify',
            },
            source: 'opening_cutover_route_test',
            reason: 'test_core_fixture',
            actorType: 'shopify',
            actingProvider: 'shopify',
          },
          trx
        )
    );

    return issueTestToken({
      userId,
      shopId: fixture.shopId,
      tier: 'core',
      roles: [role],
    });
  }

  it(
    'GRILL-05A — owner crosses real auth/FT2/Core/RBAC GET→POST→GET; missing stable Shopify Shop GID fails preflight with no cutover, batches or sync marker (GH-1179)',
    async () => {
      const fixture = await createFixture();

      const started =
        await startShop(fixture);

      await settleAllEmpty(
        fixture,
        started.bins
      );

      const token =
        await enableHttpAccess(
          fixture,
          fixture.ownerId,
          'owner'
        );

      const before =
        await request(app)
          .get(
            '/api/v1/wms/opening-inventory/progress'
          )
          .set(
            'Authorization',
            `Bearer ${token}`
          );

      expect(before.status).toBe(200);
      expect(
        before.body.progress.state
      ).toBe('ready_for_cutover');
      expect(before.body.cutover).toBeNull();
      expect(
        before.body.shopify_synced_at
      ).toBeNull();

      const approve =
        await request(app)
          .post(
            '/api/v1/wms/opening-inventory/cutover'
          )
          .set(
            'Authorization',
            `Bearer ${token}`
          )
          .send({
            accept_physical_truth: false,
          });

      // GH-1179: this fixture has no stable Shopify Shop GID; the modern
      // generation preflight rejects it before provider collection.
      expect(approve.status).toBe(409);
      expect(
        approve.body.code
      ).toBe('OPENING_CUTOVER_PREFLIGHT');

      const persisted =
        await withTenant(
          fixture.shopId,
          async (trx) => {
            const cutover =
              await trx(
                'opening_inventory_cutovers'
              )
                .where({
                  shop_id: fixture.shopId,
                })
                .first();

            const batches =
              await trx(
                'opening_inventory_cutover_batches'
              )
                .where({
                  shop_id: fixture.shopId,
                });

            const settings =
              await trx(
                'shop_wms_settings'
              )
                .where({
                  shop_id: fixture.shopId,
                })
                .select(
                  'opening_inventory_shopify_synced_at'
                )
                .first();

            return {
              cutover,
              batchCount:
                batches.length,
              syncedAt:
                settings
                  ?.opening_inventory_shopify_synced_at ??
                null,
            };
          }
        );

      expect(
        persisted.cutover
      ).toBeUndefined();
      expect(
        persisted.batchCount
      ).toBe(0);
      expect(
        persisted.syncedAt
      ).toBeNull();

      const after =
        await request(app)
          .get(
            '/api/v1/wms/opening-inventory/progress'
          )
          .set(
            'Authorization',
            `Bearer ${token}`
          );

      expect(after.status).toBe(200);
      expect(
        after.body.progress.state
      ).toBe('ready_for_cutover');
      expect(
        after.body.cutover
      ).toBeNull();
      expect(
        after.body.shopify_synced_at
      ).toBeNull();
    }
  );

  it(
    'GRILL-05B — Core FT2 operator reaches real RBAC boundary and cannot approve opening cutover',
    async () => {
      const fixture = await createFixture();

      const token =
        await enableHttpAccess(
          fixture,
          fixture.operatorId,
          'operator'
        );

      const response =
        await request(app)
          .post(
            '/api/v1/wms/opening-inventory/cutover'
          )
          .set(
            'Authorization',
            `Bearer ${token}`
          )
          .send({
            accept_physical_truth: false,
          });

      expect(response.status).toBe(403);
      expect(
        response.body.error
      ).toBe('ACTION_FORBIDDEN');

      const rows =
        await withTenant(
          fixture.shopId,
          (trx) =>
            trx(
              'opening_inventory_cutovers'
            )
              .where({
                shop_id: fixture.shopId,
              })
              .select('cutover_id')
        );

      expect(rows).toHaveLength(0);
    }
  );
});

// GH-1179 RED-A — Opening Inventory cannot begin, or certify Shopify sync,
// unless its Shopify inventory scope is provably safe:
//   exactly one participating warehouse, explicitly mapped before count start;
//   the mapping is frozen while the workflow is active;
//   legacy aggregate expectations are not location-scoped evidence, even at
//   zero difference.
describe('GH-1179 RED-A — opening inventory start / Shopify scope safety', () => {
  const app = createApp();

  beforeEach(() => {
    mockShopifyRequest.mockReset();
    mockCreateShopifyGraphQLClient.mockClear();
  });

  async function openingStartState(shopId: number) {
    return withTenant(shopId, async (trx) => {
      const taskCount = await trx('inventory_recount_tasks')
        .where({ shop_id: shopId, purpose: 'opening_inventory' })
        .count<{ count: string }>('* as count')
        .first();

      const settings = await trx('shop_wms_settings')
        .where({ shop_id: shopId })
        .first('opening_inventory_reconciliation_started_at');

      return {
        openingTasks: Number(taskCount?.count ?? 0),
        startedAt:
          settings?.opening_inventory_reconciliation_started_at ?? null,
      };
    });
  }

  async function attemptStart(fixture: Fixture): Promise<unknown> {
    try {
      await startShop(fixture);
      return null;
    } catch (error) {
      return error;
    }
  }

  async function readMapping(fixture: Fixture): Promise<string | null> {
    const row = await withTenant(fixture.shopId, (trx) =>
      trx('warehouses')
        .where({ shop_id: fixture.shopId, warehouse_id: fixture.warehouseId })
        .first('external_location_id')
    );

    return row?.external_location_id ?? null;
  }

  it('GH1179-A1 — unmapped single warehouse: shop-wide start is rejected before any opening cohort exists', async () => {
    const fixture = await createFixture({ mappedLocation: null });

    expect(await openingStartState(fixture.shopId)).toEqual({
      openingTasks: 0,
      startedAt: null,
    });

    const error = await attemptStart(fixture);

    expect(await openingStartState(fixture.shopId)).toEqual({
      openingTasks: 0,
      startedAt: null,
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/shopify location/i);
  });

  it('GH1179-A2 — two countable active warehouses: start fails closed before any cross-warehouse cohort exists', async () => {
    const fixture = await createFixture();

    const secondWarehouseId = await addWarehouse(fixture, {
      mappedLocation: `21${fixture.shopId}`,
    });

    await withTenant(fixture.shopId, async (trx) => {
      const secondRoot = await trx('warehouses')
        .where({ shop_id: fixture.shopId, warehouse_id: secondWarehouseId })
        .first('root_location_code');

      await trx('warehouse_locations').insert({
        shop_id: fixture.shopId,
        warehouse_id: secondWarehouseId,
        location_code: `${secondRoot.root_location_code}-B1`,
        type: 'bin',
        parent_location_code: secondRoot.root_location_code,
        active: true,
        zone_type: 'storage',
      });
    });

    expect(await openingStartState(fixture.shopId)).toEqual({
      openingTasks: 0,
      startedAt: null,
    });

    const error = await attemptStart(fixture);

    expect(await openingStartState(fixture.shopId)).toEqual({
      openingTasks: 0,
      startedAt: null,
    });
    expect(error).toBeInstanceOf(Error);
  });

  it('GH1179-A3 — once opening inventory has started, the warehouse Shopify Location mapping cannot be changed or cleared', async () => {
    const fixture = await createFixture({ installation: false });

    await withTenant(fixture.shopId, (trx) =>
      trx('shopify_app_installations').insert({
        shop_id: fixture.shopId,
        shop_domain: `gh1179-a3-${fixture.shopId}.myshopify.com`,
        scopes: 'read_locations,write_inventory',
      })
    );

    mockShopifyRequest.mockImplementation(async (_query: string, options: any) => ({
      data: {
        node: {
          id: options?.variables?.id,
          name: 'GH-1179 stub location',
          isActive: true,
        },
      },
    }));

    const ownerToken = issueTestToken({
      userId: fixture.ownerId,
      shopId: fixture.shopId,
      tier: 'core',
      roles: ['owner'],
    });

    const patchMapping = (shopifyLocationId: string | null) =>
      request(app)
        .patch(`/api/v1/settings/shop/warehouses/${fixture.warehouseId}/shopify-location`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ shopify_location_id: shopifyLocationId });

    // Control: before Opening Inventory starts, the real route can remap.
    const lockedLocationId = `31${fixture.shopId}`;
    const preStart = await patchMapping(lockedLocationId);
    expect(preStart.status).toBe(200);
    expect(await readMapping(fixture)).toBe(lockedLocationId);

    await startShop(fixture);
    expect((await openingStartState(fixture.shopId)).openingTasks).toBeGreaterThan(0);

    const change = await patchMapping(`32${fixture.shopId}`);
    const mappingAfterChange = await readMapping(fixture);

    const clear = await patchMapping(null);
    const mappingAfterClear = await readMapping(fixture);

    const statusClass = (status: number) =>
      status >= 400 && status < 500 ? 'rejected_4xx' : `status_${status}`;

    expect({
      change: statusClass(change.status),
      mappingAfterChange,
      clear: statusClass(clear.status),
      mappingAfterClear,
    }).toEqual({
      change: 'rejected_4xx',
      mappingAfterChange: lockedLocationId,
      clear: 'rejected_4xx',
      mappingAfterClear: lockedLocationId,
    });
  });

  it('GH1179-A4 — legacy aggregate expectation at exact zero difference does not certify Shopify sync', async () => {
    const fixture = await createFixture();

    // Legacy shopify_opening_inventory_expectations carries no warehouse or
    // Shopify Location provenance. Observed physical count equals it exactly.
    await seedExpectation(fixture, 2);
    await makePositiveReview(fixture, 2);

    const progress = await withTenant(fixture.shopId, (trx) =>
      getShopOpeningInventoryProgress(trx, fixture.shopId)
    );
    expect(progress.state).toBe('ready_for_cutover');
    expect(progress.difference_count).toBe(0);

    const executorCalls: unknown[] = [];
    let outcome: Awaited<ReturnType<typeof approveAndRunOpeningInventoryCutover>> | null = null;

    try {
      outcome = await approveAndRunOpeningInventoryCutover({
        shopId: fixture.shopId,
        actingUserId: fixture.ownerId,
        executor: async (params) => {
          executorCalls.push(params);
          throw new Error('[GH1179_TEST] provider executor must not be reached');
        },
      });
    } catch {
      outcome = null;
    }

    const cutover = await readCutover(fixture.shopId);
    const syncedAt = await readSyncedAt(fixture.shopId);

    expect({
      cutoverComplete: cutover?.status === 'complete',
      shopifySynced: syncedAt != null,
      resultComplete: outcome?.status === 'complete',
    }).toEqual({
      cutoverComplete: false,
      shopifySynced: false,
      resultComplete: false,
    });
    expect(executorCalls).toHaveLength(0);
  });
});
