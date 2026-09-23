/**
 * RECONCILIATION-CONFLICT-02
 *
 * Post-baseline Shopify fulfillment must not poison the orders projection when
 * the external commerce fact is valid but LaSyncro cannot determine one safe
 * internal physical location.
 *
 * Contract:
 *
 * Shopify says:
 *   order fulfilled
 *
 * LaSyncro knows:
 *   enough physical stock exists at >1 eligible internal locations
 *
 * Therefore:
 *   - commerce fulfillment truth advances
 *   - LaSyncro DOES NOT guess a bin/location
 *   - no fulfillment_removal is written
 *   - one durable reconciliation conflict is opened
 *   - one Problem Center task is opened
 *   - one Ops alert is opened
 *   - replay of the same domain event creates no duplicates
 *
 * The direct physical resolver keeps LOCATION_AMBIGUOUS as a hard invariant;
 * only the external fulfillment orchestration converts it to actionable state.
 */

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { issueTestToken } from '../../unit/helpers/auth';

import {
  runWithTenantContext,
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

import { processDomainEvent } from
  'api-src/events/processDomainEvent';

import * as fulfillmentReconciliationService from
  'api-src/services/wms/fulfillmentReconciliationConflict.service';

import {
  claimRecountTask,
  recordCount,
  closeCount,
  reviewLine,
  commitRecount,
} from 'api-src/services/wms/inventoryRecount.service';

const app = createApp();

jest.setTimeout(120000);

type Fixture = {
  shopId: number;
  orderId: string;
  productId: string;
  variantId: string;
  lineId: string;
  externalOrderId: string;
  eventId: number;
  eventTime: Date;
  requesterUserId: number;
  token: string;
};

async function createFixture(
  input: {
    shopifyFulfillmentId?: string;
  } = {}
): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `fulfillment-reconciliation-${unique}`
    );

    await setTenantContext(trx, id);
    return id;
  });

  const orderId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const lineId = crypto.randomUUID();

  /**
   * external_order_identity_map requires numeric Shopify order identity.
   */
  const externalOrderId =
    String(9000000000000 + shopId);

  const createdAt =
    new Date('2026-09-01T00:00:00.000Z');

  const eventTime =
    new Date('2026-09-02T00:00:00.000Z');

  let eventId = 0;
  let requesterUserId = 0;

  await withTenant(shopId, async (trx) => {
    const [requester] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `reconciliation-owner-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    requesterUserId = Number(
      (requester as any).id ?? requester
    );

    /**
     * P1D_HTTP_AUTH_FIXTURE
     *
     * Real recount HTTP routes enforce membership, FT2 lifecycle,
     * inventory.core capability, and action permissions.
     */
    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: requesterUserId,
      role: 'owner',
    });

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: requesterUserId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });

    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    /**
     * Canonical Shopify installation provisions this row before WMS use.
     * createTenantShop() is a lower-level tenant helper, so this fixture must
     * model that install invariant explicitly.
     */
    await trx('shop_wms_settings')
      .insert({ shop_id: shopId, bootstrap_model: 'legacy_opening_balance_v1' })
      .onConflict('shop_id')
      .ignore();

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Reconciliation conflict product',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `RECON-${unique}`,
      title: 'Reconciliation conflict variant',
      status: 'active',
      unit_cost: '1.00',
    });

    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      currency: 'USD',
      total_price: '10.00',
      subtotal_price: '10.00',
      total_tax: '0.00',
      order_created_at: createdAt,
      order_updated_at: createdAt,
      created_at: createdAt,
      updated_at: createdAt,
    });

    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      title: 'Reconciliation conflict line',
      quantity: 1,
      unit_price: '10.00',
      line_total: '10.00',
      created_at: createdAt,
      updated_at: createdAt,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });

    /**
     * Shopify current-stock snapshot establishes the physical-authority
     * baseline at the warehouse root.
     *
     * Before the fulfillment occurs, that stock is physically transferred
     * into two real pick bins. The root therefore has zero event-time stock;
     * A-1 and B-2 are the only genuine physical candidates.
     */
    const rootCode = `WH-${shopId}-ROOT`;
    const warehouseId = crypto.randomUUID();

    /**
     * createTenantShop establishes tenant identity only. This fixture owns
     * its warehouse topology explicitly so the ambiguity is between two
     * real, countable bins in one warehouse.
     */
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Reconciliation fixture warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });

    await trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: warehouseId,
      location_code: rootCode,
      type: 'warehouse',
      parent_location_code: null,
      active: true,
      zone_type: null,
    });

    await trx('warehouse_locations')
      .insert([
        {
          shop_id: shopId,
          warehouse_id: warehouseId,
          location_code: 'A-1',
          type: 'bin',
          parent_location_code: rootCode,
          active: true,
          zone_type: 'pick',
        },
        {
          shop_id: shopId,
          warehouse_id: warehouseId,
          location_code: 'B-2',
          type: 'bin',
          parent_location_code: rootCode,
          active: true,
          zone_type: 'pick',
        },
      ])
      .onConflict(['shop_id', 'location_code'])
      .ignore();

    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      movement_type: 'opening_balance',
      quantity_delta: 4,
      location_code: rootCode,
      reference_type: 'test_fixture',
      reference_id: crypto.randomUUID(),
      platform: 'shopify',
      triggered_by: 'system',
      occurred_at: createdAt,
    });

    const transferA = crypto.randomUUID();

    await trx('inventory_movements').insert([
      {
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        movement_type: 'location_transfer',
        quantity_delta: -2,
        location_code: rootCode,
        reference_type: 'test_fixture_transfer',
        reference_id: transferA,
        platform: null,
        triggered_by: 'system',
        occurred_at: new Date('2026-09-01T01:00:00.000Z'),
      },
      {
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        movement_type: 'location_transfer',
        quantity_delta: 2,
        location_code: 'A-1',
        reference_type: 'test_fixture_transfer',
        reference_id: transferA,
        platform: null,
        triggered_by: 'system',
        occurred_at: new Date('2026-09-01T01:00:00.000Z'),
      },
    ]);

    const transferB = crypto.randomUUID();

    await trx('inventory_movements').insert([
      {
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        movement_type: 'location_transfer',
        quantity_delta: -2,
        location_code: rootCode,
        reference_type: 'test_fixture_transfer',
        reference_id: transferB,
        platform: null,
        triggered_by: 'system',
        occurred_at: new Date('2026-09-01T01:01:00.000Z'),
      },
      {
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        movement_type: 'location_transfer',
        quantity_delta: 2,
        location_code: 'B-2',
        reference_type: 'test_fixture_transfer',
        reference_id: transferB,
        platform: null,
        triggered_by: 'system',
        occurred_at: new Date('2026-09-01T01:01:00.000Z'),
      },
    ]);

    /**
     * Recount creation consumes current inventory_truth. Keep it consistent
     * with the physical ledger so the next P1D contract can create a real
     * targeted blind count without synthetic shortcuts.
     */
    await trx('inventory_truth').insert([
      {
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        location_code: 'A-1',
        on_hand_quantity: 2,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: 2,
        last_evaluated_at:
          new Date('2026-09-01T01:01:00.000Z'),
        updated_at:
          new Date('2026-09-01T01:01:00.000Z'),
      },
      {
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        location_code: 'B-2',
        on_hand_quantity: 2,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: 2,
        last_evaluated_at:
          new Date('2026-09-01T01:01:00.000Z'),
        updated_at:
          new Date('2026-09-01T01:01:00.000Z'),
      },
    ]);

    if (input.shopifyFulfillmentId) {
      /**
       * Represents a fulfillment created by LaSyncro through
       * fulfillmentCreateV2 and persisted by the writeback service.
       *
       * Shopify may subsequently echo that exact fulfillment through
       * fulfillments/create or fulfillments/update. That echo must not
       * cause another physical debit or reconciliation incident.
       */
      await trx('order_warehouse_status').insert({
        lasyncro_order_id: orderId,
        status: 'shipped',
        status_updated_at: eventTime,
        shipped_at: eventTime,
        shopify_fulfillment_id:
          `gid://shopify/Fulfillment/${input.shopifyFulfillmentId}`,
        created_at: createdAt,
        updated_at: eventTime,
      });
    }

    const [event] = await trx('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'orders/fulfilled',
        event_payload: {
          ...(input.shopifyFulfillmentId
            ? { id: input.shopifyFulfillmentId }
            : {}),
          order_id: externalOrderId,
          status: 'fulfilled',
          line_items: [
            {
              id: lineId,
              quantity: 1,
            },
          ],
        },
        event_time: eventTime,
        event_version: 1,
        external_event_id:
          `test:shopify:fulfilled:reconciliation:${unique}`,
      })
      .returning(['id']);

    eventId = Number(event.id);
  });

  return {
    shopId,
    orderId,
    productId,
    variantId,
    lineId,
    externalOrderId,
    eventId,
    eventTime,
    requesterUserId,
    token: issueTestToken({
      userId: requesterUserId,
      shopId,
      tier: 'core',
      roles: ['owner'],
    }),
  };
}

async function projectFulfillment(
  fixture: Fixture
): Promise<void> {
  /**
   * Execute through the canonical projection boundary.
   *
   * projectDomainEvent owns:
   * - the projection transaction
   * - tenant-local DB context
   * - synchroflow.projection='true'
   * - handler dispatch
   *
   * Calling orders.fulfilled directly would test an impossible runtime path
   * and correctly trip the projection single-writer guard.
   */
  await runWithTenantContext(
    fixture.shopId,
    () => processDomainEvent(fixture.eventId)
  );
}

async function readState(fixture: Fixture) {
  return withTenant(fixture.shopId, async (trx) => {
    const fulfillment = await trx('order_fulfillment_status')
      .where({
        lasyncro_order_id: fixture.orderId,
      })
      .first(
        'status',
        'fulfilled_at'
      );

    const removals = await trx('inventory_movements')
      .where({
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.variantId,
        movement_type: 'fulfillment_removal',
        reference_type: 'order_line_item',
        reference_id: fixture.lineId,
      });

    const conflicts = await trx(
      'inventory_reconciliation_conflicts'
    )
      .where({
        shop_id: fixture.shopId,
        source_domain_event_id: fixture.eventId,
        lasyncro_line_item_id: fixture.lineId,
      })
      .select('*');

    const tasks = await trx('problem_center_tasks')
      .where({
        shop_id: fixture.shopId,
        source: 'reconciliation',
      })
      .select('*');

    const alerts = await trx('alerts')
      .where({
        shop_id: fixture.shopId,
        source: 'reconciliation',
        alert_type: 'inventory_reconciliation_conflict',
      })
      .select('*');

    return {
      fulfillment,
      removals,
      conflicts,
      tasks,
      alerts,
    };
  });
}

describe(
  'RECONCILIATION-CONFLICT-02 — ambiguous external fulfillment',
  () => {
    it(
      'commits commerce truth and opens one idempotent reconciliation problem instead of guessing or poisoning projection',
      async () => {
        const fixture = await createFixture();

        const previousRebuildMode = process.env.REBUILD_MODE;
        process.env.REBUILD_MODE = 'true';

        try {
          /**
           * Current behavior is RED here:
           *
           * [FULFILLMENT_PHYSICAL_REMOVAL]
           * LOCATION_AMBIGUOUS
           *
           * Target behavior: handler converts that diagnosis into durable
           * reconciliation state and returns successfully.
           */
          await expect(
            projectFulfillment(fixture)
          ).resolves.toBeUndefined();

          const first = await readState(fixture);

          expect(first.fulfillment).toMatchObject({
            status: 'fulfilled',
          });

          expect(
            new Date(first.fulfillment.fulfilled_at)
          ).toEqual(fixture.eventTime);

          /**
           * Never guess which internal location physically supplied the unit.
           */
          expect(first.removals).toHaveLength(0);

          expect(first.conflicts).toHaveLength(1);

          const conflict = first.conflicts[0];

          expect(conflict).toMatchObject({
            shop_id: fixture.shopId,
            conflict_type: 'fulfillment_location_ambiguous',
            source_platform: 'shopify',
            source_domain_event_id: String(fixture.eventId),
            lasyncro_order_id: fixture.orderId,
            lasyncro_line_item_id: fixture.lineId,
            lasyncro_variant_id: fixture.variantId,
            quantity: 1,
            status: 'open',
          });

          expect(
            new Date(conflict.occurred_at)
          ).toEqual(fixture.eventTime);

          expect(conflict.candidate_locations).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                location_code: 'A-1',
              }),
              expect.objectContaining({
                location_code: 'B-2',
              }),
            ])
          );

          expect(first.tasks).toHaveLength(1);

          expect(first.tasks[0]).toMatchObject({
            shop_id: fixture.shopId,
            source: 'reconciliation',
            source_exception_id: conflict.conflict_id,
            lasyncro_variant_id: fixture.variantId,
            quantity: 1,
            exception_type: 'fulfillment_location_ambiguous',
            status: 'open',
          });

          expect(first.alerts).toHaveLength(1);

          expect(first.alerts[0]).toMatchObject({
            shop_id: fixture.shopId,
            source: 'reconciliation',
            alert_type: 'inventory_reconciliation_conflict',
            severity: 'warning',
            title: 'Inventory conflict needs review',
            entity_id: conflict.conflict_id,
            entity_type: 'inventory_reconciliation_conflict',
            is_active: true,
            category: 'data_trust',
          });

          /**
           * Replay the SAME domain event.
           *
           * Domain-event replay is normal projection behavior. The replay
           * identity added in 0181 must collapse every operator-facing artifact
           * to the original conflict.
           */
          await expect(
            projectFulfillment(fixture)
          ).resolves.toBeUndefined();

          const replay = await readState(fixture);

          expect(replay.removals).toHaveLength(0);
          expect(replay.conflicts).toHaveLength(1);
          expect(replay.tasks).toHaveLength(1);
          expect(replay.alerts).toHaveLength(1);

          expect(
            replay.conflicts[0].conflict_id
          ).toBe(conflict.conflict_id);

          expect(
            replay.tasks[0].source_exception_id
          ).toBe(conflict.conflict_id);

          expect(
            replay.alerts[0].entity_id
          ).toBe(conflict.conflict_id);
        } finally {
          if (previousRebuildMode === undefined) {
            delete process.env.REBUILD_MODE;
          } else {
            process.env.REBUILD_MODE = previousRebuildMode;
          }
        }
      }
    );

    it(
      'RECONCILIATION-CONFLICT-03 — creates one linked blind recount for candidate bins and keeps the parent incident open',
      async () => {
        const fixture = await createFixture();

        const previousRebuildMode = process.env.REBUILD_MODE;
        process.env.REBUILD_MODE = 'true';

        try {
          await expect(
            projectFulfillment(fixture)
          ).resolves.toBeUndefined();

          const before = await readState(fixture);

          expect(before.conflicts).toHaveLength(1);

          const conflict = before.conflicts[0];

          expect(conflict).toMatchObject({
            status: 'open',
            recount_task_id: null,
            recount_requested_at: null,
            recount_requested_by: null,
          });

          const requestRecount =
            (fulfillmentReconciliationService as any)
              .requestFulfillmentReconciliationRecount;

          /**
           * RED seam:
           * reconciliation currently persists the incident but exposes no
           * operation that turns its candidate bins into linked blind
           * verification work.
           */
          expect(typeof requestRecount).toBe('function');

          if (typeof requestRecount !== 'function') {
            return;
          }

          const first = await withTenant(
            fixture.shopId,
            (trx) =>
              requestRecount(trx, {
                shopId: fixture.shopId,
                conflictId: conflict.conflict_id,
                requestedBy: fixture.requesterUserId,
              })
          );

          const second = await withTenant(
            fixture.shopId,
            (trx) =>
              requestRecount(trx, {
                shopId: fixture.shopId,
                conflictId: conflict.conflict_id,
                requestedBy: fixture.requesterUserId,
              })
          );

          expect(first.recountTaskId).toBeTruthy();
          expect(second.recountTaskId).toBe(
            first.recountTaskId
          );

          const after = await withTenant(
            fixture.shopId,
            async (trx) => {
              const conflictRow = await trx(
                'inventory_reconciliation_conflicts'
              )
                .where({
                  shop_id: fixture.shopId,
                  conflict_id: conflict.conflict_id,
                })
                .first();

              const recountTasks = await trx(
                'inventory_recount_tasks'
              )
                .where({
                  shop_id: fixture.shopId,
                })
                .select('*');

              const recountLines = conflictRow?.recount_task_id
                ? await trx('inventory_recount_lines')
                    .where({
                      shop_id: fixture.shopId,
                      recount_task_id:
                        conflictRow.recount_task_id,
                    })
                    .orderBy('location_code', 'asc')
                    .select('*')
                : [];

              const candidateBins = await trx(
                'warehouse_locations'
              )
                .where({
                  shop_id: fixture.shopId,
                })
                .whereIn(
                  'location_code',
                  ['A-1', 'B-2']
                )
                .orderBy('location_code', 'asc')
                .select(
                  'warehouse_id',
                  'location_code',
                  'type',
                  'active'
                );

              return {
                conflictRow,
                recountTasks,
                recountLines,
                candidateBins,
              };
            }
          );

          expect(after.conflictRow).toMatchObject({
            status: 'open',
            recount_task_id: first.recountTaskId,
            recount_requested_by:
              fixture.requesterUserId,
          });

          expect(
            after.conflictRow.recount_requested_at
          ).toBeTruthy();

          /**
           * Idempotency contract:
           * retries/repeated clicks must reuse the same evidence-gathering
           * work rather than dispatch duplicate warehouse tasks.
           */
          expect(after.recountTasks).toHaveLength(1);

          expect(after.recountTasks[0]).toMatchObject({
            recount_task_id: first.recountTaskId,
            scope: 'locations',
            status: 'dispatched',
            blind: true,
            created_by: fixture.requesterUserId,
          });

          expect(after.candidateBins).toHaveLength(2);

          expect(
            new Set(
              after.candidateBins.map(
                (row: any) => row.warehouse_id
              )
            ).size
          ).toBe(1);

          expect(
            after.recountTasks[0].warehouse_id
          ).toBe(
            after.candidateBins[0].warehouse_id
          );

          expect(
            after.recountLines.map((line: any) => ({
              variant: line.lasyncro_variant_id,
              location: line.location_code,
              expected: Number(line.expected_quantity),
              counted: line.counted_quantity,
            }))
          ).toEqual([
            {
              variant: fixture.variantId,
              location: 'A-1',
              expected: 2,
              counted: null,
            },
            {
              variant: fixture.variantId,
              location: 'B-2',
              expected: 2,
              counted: null,
            },
          ]);

          /**
           * Dispatching evidence gathering is NOT resolution.
           */
          const parent = await readState(fixture);

          expect(parent.conflicts[0].status).toBe('open');
          expect(parent.tasks[0].status).toBe('open');
          expect(parent.alerts[0].is_active).toBe(true);
        } finally {
          if (previousRebuildMode === undefined) {
            delete process.env.REBUILD_MODE;
          } else {
            process.env.REBUILD_MODE =
              previousRebuildMode;
          }
        }
      }
    );

    it(
      'RECONCILIATION-CONFLICT-04 — finalizes only from complete committed physical evidence without inventing fulfillment removal',
      async () => {
        const fixture = await createFixture();

        const previousRebuildMode = process.env.REBUILD_MODE;
        process.env.REBUILD_MODE = 'true';

        try {
          await projectFulfillment(fixture);

          const before = await readState(fixture);
          const conflict = before.conflicts[0];

          const requestRecount =
            (fulfillmentReconciliationService as any)
              .requestFulfillmentReconciliationRecount;

          const finalizeRecount =
            (fulfillmentReconciliationService as any)
              .finalizeFulfillmentReconciliationRecount;

          expect(typeof finalizeRecount).toBe('function');

          if (typeof finalizeRecount !== 'function') {
            return;
          }

          const requested = await withTenant(
            fixture.shopId,
            (trx) =>
              requestRecount(trx, {
                shopId: fixture.shopId,
                conflictId: conflict.conflict_id,
                requestedBy: fixture.requesterUserId,
              })
          );

          await withTenant(
            fixture.shopId,
            async (trx) => {
              const lines = await trx(
                'inventory_recount_lines'
              )
                .where({
                  shop_id: fixture.shopId,
                  recount_task_id: requested.recountTaskId,
                })
                .select(
                  'recount_line_id',
                  'expected_quantity'
                );

              expect(lines).toHaveLength(2);

              /**
               * Model a legitimate zero-variance terminal recount:
               * both blind physical counts matched their task-creation
               * snapshots, no line was skipped, and no ledger correction
               * was required.
               */
              for (const line of lines) {
                await trx('inventory_recount_lines')
                  .where({
                    shop_id: fixture.shopId,
                    recount_line_id: line.recount_line_id,
                  })
                  .update({
                    counted_quantity:
                      Number(line.expected_quantity),
                    variance: 0,
                    window_delta: 0,
                    window_computed_at: trx.fn.now(),
                    count_method: 'bin_quantity',
                    counted_by:
                      fixture.requesterUserId,
                    counted_at: trx.fn.now(),
                    skip_reason: null,
                    skipped_by: null,
                    skipped_at: null,
                    updated_at: trx.fn.now(),
                  });
              }

              await trx('inventory_recount_tasks')
                .where({
                  shop_id: fixture.shopId,
                  recount_task_id: requested.recountTaskId,
                })
                .update({
                  status: 'committed',
                  counted_at: trx.fn.now(),
                  committed_at: trx.fn.now(),
                  reviewed_by:
                    fixture.requesterUserId,
                  updated_at: trx.fn.now(),
                });
            }
          );

          const result = await withTenant(
            fixture.shopId,
            (trx) =>
              finalizeRecount(trx, {
                shopId: fixture.shopId,
                recountTaskId: requested.recountTaskId,
                resolvedBy: fixture.requesterUserId,
              })
          );

          expect(result).toMatchObject({
            finalized: true,
            conflictId: conflict.conflict_id,
            resolutionAction:
              'physical_recount_verified',
          });

          const after = await readState(fixture);

          expect(after.conflicts[0]).toMatchObject({
            status: 'resolved',
            resolution_action:
              'physical_recount_verified',
            resolution_location_code: null,
            resolved_by: fixture.requesterUserId,
          });

          expect(
            after.conflicts[0].resolved_at
          ).toBeTruthy();

          expect(after.tasks[0]).toMatchObject({
            status: 'resolved',
            resolution_action:
              'physical_recount_verified',
            resolved_by: fixture.requesterUserId,
          });

          expect(after.tasks[0].resolved_at).toBeTruthy();

          expect(after.alerts[0].is_active).toBe(false);

          const movements = await withTenant(
            fixture.shopId,
            (trx) =>
              trx('inventory_movements')
                .where({
                  shop_id: fixture.shopId,
                  lasyncro_variant_id: fixture.variantId,
                })
                .whereIn('movement_type', [
                  'fulfillment_removal',
                  'reconciliation_correction',
                ])
                .select(
                  'movement_type',
                  'quantity_delta',
                  'location_code'
                )
          );

          /**
           * Physical verification resolved the operational incident without
           * fabricating historical fulfillment attribution.
           */
          expect(movements).toEqual([]);
        } finally {
          if (previousRebuildMode === undefined) {
            delete process.env.REBUILD_MODE;
          } else {
            process.env.REBUILD_MODE =
              previousRebuildMode;
          }
        }
      }
    );

    it(
      'RECONCILIATION-CONFLICT-05 — corrects one physical variance through recount without double-debiting fulfillment',
      async () => {
        const fixture = await createFixture();

        const previousRebuildMode = process.env.REBUILD_MODE;
        process.env.REBUILD_MODE = 'true';

        try {
          await projectFulfillment(fixture);

          const before = await readState(fixture);

          expect(before.conflicts).toHaveLength(1);
          expect(before.removals).toHaveLength(0);

          const conflict = before.conflicts[0];

          const requested = await withTenant(
            fixture.shopId,
            (trx) =>
              fulfillmentReconciliationService
                .requestFulfillmentReconciliationRecount(
                  trx,
                  {
                    shopId: fixture.shopId,
                    conflictId: conflict.conflict_id,
                    requestedBy: fixture.requesterUserId,
                  }
                )
          );

          const recountTaskId = requested.recountTaskId;

          await withTenant(
            fixture.shopId,
            (trx) =>
              claimRecountTask(
                trx,
                fixture.shopId,
                recountTaskId,
                fixture.requesterUserId
              )
          );

          const lines = await withTenant(
            fixture.shopId,
            (trx) =>
              trx('inventory_recount_lines')
                .where({
                  shop_id: fixture.shopId,
                  recount_task_id: recountTaskId,
                })
                .select(
                  'recount_line_id',
                  'location_code',
                  'expected_quantity'
                )
                .orderBy('location_code', 'asc')
          );

          expect(lines).toHaveLength(2);

          expect(
            lines.map((line: any) => ({
              locationCode: line.location_code,
              expectedQuantity:
                Number(line.expected_quantity),
            }))
          ).toEqual([
            {
              locationCode: 'A-1',
              expectedQuantity: 2,
            },
            {
              locationCode: 'B-2',
              expectedQuantity: 2,
            },
          ]);

          const a1 = lines.find(
            (line: any) =>
              line.location_code === 'A-1'
          );

          const b2 = lines.find(
            (line: any) =>
              line.location_code === 'B-2'
          );

          expect(a1).toBeTruthy();
          expect(b2).toBeTruthy();

          const a1Count = await withTenant(
            fixture.shopId,
            (trx) =>
              recordCount(trx, {
                shopId: fixture.shopId,
                recountTaskId,
                recountLineId: a1.recount_line_id,
                countedQuantity: 1,
                countMethod: 'bin_quantity',
                countedBy: fixture.requesterUserId,
              })
          );

          expect(a1Count).toEqual({
            variance: -1,
            windowDelta: 0,
            contested: false,
          });

          const b2Count = await withTenant(
            fixture.shopId,
            (trx) =>
              recordCount(trx, {
                shopId: fixture.shopId,
                recountTaskId,
                recountLineId: b2.recount_line_id,
                countedQuantity: 2,
                countMethod: 'bin_quantity',
                countedBy: fixture.requesterUserId,
              })
          );

          expect(b2Count).toEqual({
            variance: 0,
            windowDelta: 0,
            contested: false,
          });

          const closed = await withTenant(
            fixture.shopId,
            (trx) =>
              closeCount(
                trx,
                fixture.shopId,
                recountTaskId,
                fixture.requesterUserId
              )
          );

          expect(closed).toMatchObject({
            status: 'manual_review',
            unresolved: 0,
            skipped: 0,
            variances: 1,
            contested: 0,
          });

          await withTenant(
            fixture.shopId,
            (trx) =>
              reviewLine(trx, {
                shopId: fixture.shopId,
                recountTaskId,
                recountLineId: a1.recount_line_id,
                decision: 'accept',
                varianceReason:
                  'unrecorded_external_workflow',
                notes:
                  'Physical verification found one fewer unit in A-1.',
                reviewedBy: fixture.requesterUserId,
              })
          );

          const committed = await withTenant(
            fixture.shopId,
            (trx) =>
              commitRecount(
                trx,
                fixture.shopId,
                recountTaskId,
                fixture.requesterUserId
              )
          );

          expect(committed).toEqual({
            corrections: 1,
            units: 1,
          });

          const accounting = await withTenant(
            fixture.shopId,
            async (trx) => {
              const corrections = await trx(
                'inventory_movements'
              )
                .where({
                  shop_id: fixture.shopId,
                  lasyncro_variant_id:
                    fixture.variantId,
                  movement_type:
                    'reconciliation_correction',
                })
                .select(
                  'quantity_delta',
                  'location_code',
                  'reference_type',
                  'reference_id',
                  'platform',
                  'triggered_by'
                );

              const fulfillmentRemovals =
                await trx('inventory_movements')
                  .where({
                    shop_id: fixture.shopId,
                    lasyncro_variant_id:
                      fixture.variantId,
                    movement_type:
                      'fulfillment_removal',
                  })
                  .select('*');

              const truth = await trx('inventory_truth')
                .where({
                  shop_id: fixture.shopId,
                  lasyncro_variant_id:
                    fixture.variantId,
                })
                .whereIn(
                  'location_code',
                  ['A-1', 'B-2']
                )
                .select(
                  'location_code',
                  'on_hand_quantity'
                )
                .orderBy('location_code', 'asc');

              const correctedLine =
                await trx('inventory_recount_lines')
                  .where({
                    shop_id: fixture.shopId,
                    recount_line_id:
                      a1.recount_line_id,
                  })
                  .first(
                    'variance',
                    'variance_reason',
                    'inventory_movement_id'
                  );

              return {
                corrections,
                fulfillmentRemovals,
                truth,
                correctedLine,
              };
            }
          );

          expect(accounting.corrections).toHaveLength(1);

          expect(accounting.corrections[0]).toMatchObject({
            location_code: 'A-1',
            reference_type: 'recount_line',
            reference_id: a1.recount_line_id,
            platform: 'wms',
            triggered_by: 'inventory_recount',
          });

          expect(
            Number(
              accounting.corrections[0].quantity_delta
            )
          ).toBe(-1);

          expect(
            accounting.correctedLine
              .inventory_movement_id
          ).toBeTruthy();

          expect(
            Number(accounting.correctedLine.variance)
          ).toBe(-1);

          expect(
            accounting.correctedLine.variance_reason
          ).toBe('unrecorded_external_workflow');

          /**
           * Critical accounting invariant:
           *
           * The physical recount correction repairs current truth.
           * We MUST NOT additionally invent a fulfillment_removal.
           */
          expect(
            accounting.fulfillmentRemovals
          ).toHaveLength(0);

          expect(
            accounting.truth.map((row: any) => ({
              locationCode: row.location_code,
              onHand: Number(row.on_hand_quantity),
            }))
          ).toEqual([
            {
              locationCode: 'A-1',
              onHand: 1,
            },
            {
              locationCode: 'B-2',
              onHand: 2,
            },
          ]);

          const finalized = await withTenant(
            fixture.shopId,
            (trx) =>
              fulfillmentReconciliationService
                .finalizeFulfillmentReconciliationRecount(
                  trx,
                  {
                    shopId: fixture.shopId,
                    recountTaskId,
                    resolvedBy:
                      fixture.requesterUserId,
                  }
                )
          );

          expect(finalized).toMatchObject({
            finalized: true,
            conflictId: conflict.conflict_id,
            resolutionAction:
              'physical_recount_corrected',
          });

          const after = await readState(fixture);

          expect(after.removals).toHaveLength(0);

          expect(after.conflicts[0]).toMatchObject({
            status: 'resolved',
            resolution_action:
              'physical_recount_corrected',
            resolution_location_code: null,
            resolved_by: fixture.requesterUserId,
          });

          expect(
            after.conflicts[0].resolved_at
          ).toBeTruthy();

          expect(after.tasks[0]).toMatchObject({
            status: 'resolved',
            resolution_action:
              'physical_recount_corrected',
            resolved_by: fixture.requesterUserId,
          });

          expect(after.tasks[0].resolved_at).toBeTruthy();

          expect(after.alerts[0].is_active).toBe(false);
        } finally {
          if (previousRebuildMode === undefined) {
            delete process.env.REBUILD_MODE;
          } else {
            process.env.REBUILD_MODE =
              previousRebuildMode;
          }
        }
      }
    );

    it(
      'P1D-HTTP-01 — closing a zero-variance linked recount automatically resolves the reconciliation incident',
      async () => {
        const fixture = await createFixture();

        const previousRebuildMode = process.env.REBUILD_MODE;
        process.env.REBUILD_MODE = 'true';

        try {
          await projectFulfillment(fixture);

          const before = await readState(fixture);
          const conflict = before.conflicts[0];

          const requested = await withTenant(
            fixture.shopId,
            (trx) =>
              fulfillmentReconciliationService
                .requestFulfillmentReconciliationRecount(
                  trx,
                  {
                    shopId: fixture.shopId,
                    conflictId: conflict.conflict_id,
                    requestedBy: fixture.requesterUserId,
                  }
                )
          );

          await withTenant(
            fixture.shopId,
            async (trx) => {
              await claimRecountTask(
                trx,
                fixture.shopId,
                requested.recountTaskId,
                fixture.requesterUserId
              );

              const lines = await trx(
                'inventory_recount_lines'
              )
                .where({
                  shop_id: fixture.shopId,
                  recount_task_id:
                    requested.recountTaskId,
                })
                .select(
                  'recount_line_id',
                  'expected_quantity'
                );

              expect(lines).toHaveLength(2);

              for (const line of lines) {
                await recordCount(trx, {
                  shopId: fixture.shopId,
                  recountTaskId:
                    requested.recountTaskId,
                  recountLineId:
                    line.recount_line_id,
                  countedQuantity:
                    Number(line.expected_quantity),
                  countMethod: 'bin_quantity',
                  countedBy:
                    fixture.requesterUserId,
                });
              }
            }
          );

          const response = await request(app)
            .post(
              `/api/v1/wms/recount-tasks/${requested.recountTaskId}/close`
            )
            .set(
              'Authorization',
              `Bearer ${fixture.token}`
            )
            .send({});

          expect(response.status).toBe(200);
          expect(response.body).toMatchObject({
            status: 'committed',
            variances: 0,
          });

          const after = await readState(fixture);

          expect(after.conflicts[0]).toMatchObject({
            status: 'resolved',
            resolution_action:
              'physical_recount_verified',
          });

          expect(after.tasks[0]).toMatchObject({
            status: 'resolved',
            resolution_action:
              'physical_recount_verified',
          });

          expect(after.alerts[0].is_active).toBe(false);
        } finally {
          if (previousRebuildMode === undefined) {
            delete process.env.REBUILD_MODE;
          } else {
            process.env.REBUILD_MODE =
              previousRebuildMode;
          }
        }
      }
    );

    it(
      'P1D-HTTP-02 — committing an accepted variance automatically resolves the reconciliation incident without a second fulfillment debit',
      async () => {
        const fixture = await createFixture();

        const previousRebuildMode = process.env.REBUILD_MODE;
        process.env.REBUILD_MODE = 'true';

        try {
          await projectFulfillment(fixture);

          const before = await readState(fixture);
          const conflict = before.conflicts[0];

          const requested = await withTenant(
            fixture.shopId,
            (trx) =>
              fulfillmentReconciliationService
                .requestFulfillmentReconciliationRecount(
                  trx,
                  {
                    shopId: fixture.shopId,
                    conflictId: conflict.conflict_id,
                    requestedBy: fixture.requesterUserId,
                  }
                )
          );

          await withTenant(
            fixture.shopId,
            async (trx) => {
              await claimRecountTask(
                trx,
                fixture.shopId,
                requested.recountTaskId,
                fixture.requesterUserId
              );

              const lines = await trx(
                'inventory_recount_lines'
              )
                .where({
                  shop_id: fixture.shopId,
                  recount_task_id:
                    requested.recountTaskId,
                })
                .select(
                  'recount_line_id',
                  'location_code'
                );

              const a1 = lines.find(
                (line: any) =>
                  line.location_code === 'A-1'
              );

              const b2 = lines.find(
                (line: any) =>
                  line.location_code === 'B-2'
              );

              expect(a1).toBeTruthy();
              expect(b2).toBeTruthy();

              await recordCount(trx, {
                shopId: fixture.shopId,
                recountTaskId:
                  requested.recountTaskId,
                recountLineId:
                  a1.recount_line_id,
                countedQuantity: 1,
                countMethod: 'bin_quantity',
                countedBy:
                  fixture.requesterUserId,
              });

              await recordCount(trx, {
                shopId: fixture.shopId,
                recountTaskId:
                  requested.recountTaskId,
                recountLineId:
                  b2.recount_line_id,
                countedQuantity: 2,
                countMethod: 'bin_quantity',
                countedBy:
                  fixture.requesterUserId,
              });

              const closed = await closeCount(
                trx,
                fixture.shopId,
                requested.recountTaskId,
                fixture.requesterUserId
              );

              expect(closed.status).toBe(
                'manual_review'
              );

              await reviewLine(trx, {
                shopId: fixture.shopId,
                recountTaskId:
                  requested.recountTaskId,
                recountLineId:
                  a1.recount_line_id,
                decision: 'accept',
                varianceReason:
                  'unrecorded_external_workflow',
                reviewedBy:
                  fixture.requesterUserId,
              });
            }
          );

          const response = await request(app)
            .post(
              `/api/v1/wms/recount-tasks/${requested.recountTaskId}/commit`
            )
            .set(
              'Authorization',
              `Bearer ${fixture.token}`
            )
            .send({});

          expect(response.status).toBe(200);
          expect(response.body).toMatchObject({
            corrections: 1,
            units: 1,
          });

          const after = await readState(fixture);

          expect(after.removals).toHaveLength(0);

          expect(after.conflicts[0]).toMatchObject({
            status: 'resolved',
            resolution_action:
              'physical_recount_corrected',
          });

          expect(after.tasks[0]).toMatchObject({
            status: 'resolved',
            resolution_action:
              'physical_recount_corrected',
          });

          expect(after.alerts[0].is_active).toBe(false);

          const corrections = await withTenant(
            fixture.shopId,
            (trx) =>
              trx('inventory_movements')
                .where({
                  shop_id: fixture.shopId,
                  lasyncro_variant_id:
                    fixture.variantId,
                  movement_type:
                    'reconciliation_correction',
                })
                .select(
                  'quantity_delta',
                  'location_code'
                )
          );

          expect(corrections).toHaveLength(1);

          expect(corrections[0]).toMatchObject({
            location_code: 'A-1',
          });

          expect(
            Number(corrections[0].quantity_delta)
          ).toBe(-1);
        } finally {
          if (previousRebuildMode === undefined) {
            delete process.env.REBUILD_MODE;
          } else {
            process.env.REBUILD_MODE =
              previousRebuildMode;
          }
        }
      }
    );

    it(
      'treats the exact Shopify fulfillment written by LaSyncro as an echo with no second physical action',
      async () => {
        const shopifyFulfillmentId = '9876543210123';

        const fixture = await createFixture({
          shopifyFulfillmentId,
        });

        const previousRebuildMode = process.env.REBUILD_MODE;
        process.env.REBUILD_MODE = 'true';

        try {
          await expect(
            projectFulfillment(fixture)
          ).resolves.toBeUndefined();

          const state = await readState(fixture);

          expect(state.fulfillment).toMatchObject({
            status: 'fulfilled',
          });

          expect(state.removals).toHaveLength(0);
          expect(state.conflicts).toHaveLength(0);
          expect(state.tasks).toHaveLength(0);
          expect(state.alerts).toHaveLength(0);
        } finally {
          if (previousRebuildMode === undefined) {
            delete process.env.REBUILD_MODE;
          } else {
            process.env.REBUILD_MODE = previousRebuildMode;
          }
        }
      }
    );
  }
);
