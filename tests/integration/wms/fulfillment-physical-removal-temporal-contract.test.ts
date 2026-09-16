/**
 * FULFILLMENT-PHYSICAL-TIME-01
 *
 * Regression contract for Shopify fulfillment physical fallback.
 *
 * Physical inventory authority begins for a synced Shopify variant at its
 * Shopify opening-balance snapshot. Historical fulfillments before that
 * baseline may reconstruct order/fulfillment state, but must not infer where
 * stock physically left the warehouse when no explicit WMS execution evidence
 * exists.
 *
 * After the baseline, fallback location resolution must use physical ledger
 * semantics at fulfillment event-time:
 *   - no future movements
 *   - ordinary economic `sale` rows do not change physical on-hand
 *   - genuine multi-location ambiguity remains fatal
 *
 * Direct service + real disposable PostgreSQL. HTTP adds no contract value.
 */

import crypto from 'crypto';

import db, {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import { applyFulfillmentPhysicalRemoval } from
  'api-src/services/wms/fulfillmentPhysicalRemoval.service';

jest.setTimeout(120000);

type Fixture = {
  shopId: number;
  orderId: string;
  productId: string;
  variantId: string;
  lineId: string;
};

async function createFixture(label: string): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `fulfillment-time-${label}-${unique}`
    );

    await setTenantContext(trx, id);
    return id;
  });

  const orderId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const lineId = crypto.randomUUID();
  const now = new Date('2026-09-16T12:00:00.000Z');

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: `Temporal ${label} product`,
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `TEMP-${label}-${unique}`,
      title: `Temporal ${label} variant`,
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
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      title: `Temporal ${label} line`,
      quantity: 1,
      unit_price: '10.00',
      line_total: '10.00',
      created_at: now,
      updated_at: now,
    });
  });

  return {
    shopId,
    orderId,
    productId,
    variantId,
    lineId,
  };
}

async function insertMovement(
  fixture: Fixture,
  input: {
    movementType: string;
    quantity: number;
    locationCode: string;
    occurredAt: string;
    platform?: string | null;
    triggeredBy?: string | null;
    referenceType?: string;
  }
): Promise<void> {
  await withTenant(fixture.shopId, (trx) =>
    trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      shop_id: fixture.shopId,
      lasyncro_variant_id: fixture.variantId,
      movement_type: input.movementType,
      quantity_delta: input.quantity,
      location_code: input.locationCode,
      reference_type: input.referenceType ?? 'test_fixture',
      reference_id: crypto.randomUUID(),
      platform: input.platform ?? null,
      triggered_by: input.triggeredBy ?? 'system',
      occurred_at: new Date(input.occurredAt),
    })
  );
}

async function fulfillmentRemovals(fixture: Fixture) {
  return withTenant(fixture.shopId, (trx) =>
    trx('inventory_movements')
      .where({
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.variantId,
        reference_type: 'order_line_item',
        reference_id: fixture.lineId,
        movement_type: 'fulfillment_removal',
      })
      .select(
        'location_code',
        'quantity_delta',
        'occurred_at'
      )
  );
}

async function warehouseLineStatus(fixture: Fixture) {
  return withTenant(fixture.shopId, (trx) =>
    trx('order_line_item_warehouse_status')
      .where({
        shop_id: fixture.shopId,
        lasyncro_line_item_id: fixture.lineId,
      })
      .first('status')
  );
}

describe('FULFILLMENT-PHYSICAL-TIME-01', () => {
  it(
    'does not infer physical removal for a historical fulfillment before the Shopify opening-balance baseline',
    async () => {
      const fixture = await createFixture('pre-baseline');

      // Existing non-Shopify local stock mirrors the contaminated dev fixture.
      await insertMovement(fixture, {
        movementType: 'opening_balance',
        quantity: 12,
        locationCode: 'B-2',
        occurredAt: '2026-08-03T00:00:00.000Z',
        platform: null,
      });

      // Shopify establishes physical authority later through its current-stock
      // snapshot. A historical Aug-4 fulfillment must not consume this Sep-16
      // snapshot OR infer that the old local B-2 balance supplied the order.
      await insertMovement(fixture, {
        movementType: 'opening_balance',
        quantity: 34,
        locationCode: `WH-${fixture.shopId}-ROOT`,
        occurredAt: '2026-09-16T00:00:00.000Z',
        platform: 'shopify',
      });

      const fulfilledAt =
        new Date('2026-08-04T18:06:13.000Z');

      await expect(
        withTenant(fixture.shopId, (trx) =>
          applyFulfillmentPhysicalRemoval(
            trx,
            fixture.shopId,
            fixture.orderId,
            fulfilledAt
          )
        )
      ).resolves.toBeUndefined();

      expect(await fulfillmentRemovals(fixture)).toHaveLength(0);

      expect(await warehouseLineStatus(fixture)).toMatchObject({
        status: 'shipped',
      });
    }
  );

  it(
    'resolves post-baseline fallback from physical event-time state, ignoring economic sale and future stock',
    async () => {
      const fixture = await createFixture('event-time');

      // Physical Shopify baseline: two units physically at ROOT.
      await insertMovement(fixture, {
        movementType: 'opening_balance',
        quantity: 2,
        locationCode: `WH-${fixture.shopId}-ROOT`,
        occurredAt: '2026-09-01T00:00:00.000Z',
        platform: 'shopify',
      });

      // Economic ingestion only. Canonical physical reconstruction deliberately
      // excludes ordinary sale rows.
      await insertMovement(fixture, {
        movementType: 'sale',
        quantity: -2,
        locationCode: `WH-${fixture.shopId}-ROOT`,
        occurredAt: '2026-09-01T12:00:00.000Z',
        triggeredBy: 'reconciliation_unlocated',
        referenceType: 'order_revenue_unit',
      });

      // This physical stock does not exist yet at fulfillment event-time.
      await insertMovement(fixture, {
        movementType: 'manual_adjustment',
        quantity: 2,
        locationCode: 'A-1',
        occurredAt: '2026-09-03T00:00:00.000Z',
      });

      const fulfilledAt =
        new Date('2026-09-02T00:00:00.000Z');

      await expect(
        withTenant(fixture.shopId, (trx) =>
          applyFulfillmentPhysicalRemoval(
            trx,
            fixture.shopId,
            fixture.orderId,
            fulfilledAt
          )
        )
      ).resolves.toBeUndefined();

      const rows = await fulfillmentRemovals(fixture);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        location_code: `WH-${fixture.shopId}-ROOT`,
        quantity_delta: -1,
      });
    }
  );

  it(
    'still refuses to guess when two physical locations genuinely qualify at fulfillment event-time',
    async () => {
      const fixture = await createFixture('ambiguous');

      await insertMovement(fixture, {
        movementType: 'opening_balance',
        quantity: 2,
        locationCode: `WH-${fixture.shopId}-ROOT`,
        occurredAt: '2026-09-01T00:00:00.000Z',
        platform: 'shopify',
      });

      await insertMovement(fixture, {
        movementType: 'manual_adjustment',
        quantity: 2,
        locationCode: 'B-2',
        occurredAt: '2026-09-01T01:00:00.000Z',
      });

      await expect(
        withTenant(fixture.shopId, (trx) =>
          applyFulfillmentPhysicalRemoval(
            trx,
            fixture.shopId,
            fixture.orderId,
            new Date('2026-09-02T00:00:00.000Z')
          )
        )
      ).rejects.toThrow(
        `[FULFILLMENT_PHYSICAL_REMOVAL] LOCATION_AMBIGUOUS line=${fixture.lineId}`
      );

      expect(await fulfillmentRemovals(fixture)).toHaveLength(0);
    }
  );
});
