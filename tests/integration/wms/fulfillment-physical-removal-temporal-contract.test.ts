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

async function createFixture(
  label: string,
  bootstrapModel:
    | 'legacy_opening_balance_v1'
    | 'reconcile_opening_expectation_v2'
    | null = 'legacy_opening_balance_v1'
): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `fulfillment-time-${label}-${unique}`
    );

    await setTenantContext(trx, id);
    return id;
  });

  // createTenantShop only inserts into public.shops — no shop_wms_settings
  // row exists for this shop yet (ISSUE-12, confirmed via migration 0193's
  // own comments, and via the identical fixture pattern in
  // tests/integration/inventory/shopify-opening-expectations-v2.test.ts).
  // Provision it explicitly with the requested classification so the
  // resolver cutover in fulfillmentPhysicalRemoval.service.ts has a
  // bootstrap_model to read. `bootstrapModel === null` deliberately leaves
  // shop_wms_settings unprovisioned (S3-06: missing-classification fixture).
  if (bootstrapModel !== null) {
    await withTenant(shopId, (trx) =>
      trx('shop_wms_settings')
        .insert({ shop_id: shopId, bootstrap_model: bootstrapModel })
        .onConflict('shop_id')
        .ignore()
    );
  }

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

async function insertExpectation(
  shopId: number,
  variantId: string,
  observedAt: string
): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('shopify_opening_inventory_expectations').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      external_variant_id: `gid://shopify/ProductVariant/${variantId.slice(0, 8)}`,
      reported_quantity: 1,
      expected_quantity: 1,
      observed_at: new Date(observedAt),
    })
  );
}

async function seedSiblingVariant(
  shopId: number,
  label: string
): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: `Temporal ${label} sibling product`,
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `TEMP-SIB-${variantId.slice(0, 8)}`,
      title: `Temporal ${label} sibling variant`,
      status: 'active',
      unit_cost: '1.00',
    });
  });

  return variantId;
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

  it(
    'S3-03: v2 shop — does not infer physical removal for a fulfillment before the expectation-row baseline, with zero opening_balance rows involved',
    async () => {
      const fixture = await createFixture(
        's3-03-v2-pre-baseline',
        'reconcile_opening_expectation_v2'
      );

      // v2 never writes opening_balance — the baseline is this expectation row.
      await insertExpectation(
        fixture.shopId,
        fixture.variantId,
        '2026-09-16T00:00:00.000Z'
      );

      const fulfilledAt = new Date('2026-08-04T18:06:13.000Z');

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

      const openingBalanceMovements = await withTenant(
        fixture.shopId,
        (trx) =>
          trx('inventory_movements').where({
            shop_id: fixture.shopId,
            lasyncro_variant_id: fixture.variantId,
            movement_type: 'opening_balance',
          })
      );
      expect(openingBalanceMovements).toHaveLength(0);
    }
  );

  it(
    'S3-04: v2 shop — resolves normal physical-removal path for a fulfillment after the expectation-row baseline',
    async () => {
      const fixture = await createFixture(
        's3-04-v2-post-baseline',
        'reconcile_opening_expectation_v2'
      );

      await insertExpectation(
        fixture.shopId,
        fixture.variantId,
        '2026-09-01T00:00:00.000Z'
      );

      // Physical stock arriving after the baseline — v2 never writes
      // opening_balance, so physical truth is established by ordinary
      // WMS movements, not by the expectation row.
      await insertMovement(fixture, {
        movementType: 'manual_adjustment',
        quantity: 2,
        locationCode: `WH-${fixture.shopId}-ROOT`,
        occurredAt: '2026-09-01T06:00:00.000Z',
      });

      const fulfilledAt = new Date('2026-09-02T00:00:00.000Z');

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

      expect(await warehouseLineStatus(fixture)).toMatchObject({
        status: 'shipped',
      });
    }
  );

  it(
    'S3-05: v2 shop — a variant with no expectation row is not classified as pre-baseline merely because a sibling variant in the same shop has one',
    async () => {
      const fixture = await createFixture(
        's3-05-v2-per-variant-scope',
        'reconcile_opening_expectation_v2'
      );

      const siblingVariantId = await seedSiblingVariant(
        fixture.shopId,
        's3-05'
      );

      // Sibling variant HAS an expectation row — the fixture's own line-item
      // variant does not.
      await insertExpectation(
        fixture.shopId,
        siblingVariantId,
        '2026-09-16T00:00:00.000Z'
      );

      // Physical stock for the fixture's own (unbaselined) variant, so the
      // normal removal path can actually execute rather than throwing
      // LOCATION_NOT_FOUND — proving this ran the removal path, not the
      // pre-baseline skip.
      await insertMovement(fixture, {
        movementType: 'manual_adjustment',
        quantity: 2,
        locationCode: `WH-${fixture.shopId}-ROOT`,
        occurredAt: '2026-08-01T00:00:00.000Z',
      });

      // Deliberately BEFORE the sibling's expectation observed_at, to prove
      // the sibling's baseline is never consulted for this variant.
      const fulfilledAt = new Date('2026-08-04T18:06:13.000Z');

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

      expect(await warehouseLineStatus(fixture)).toMatchObject({
        status: 'shipped',
      });
    }
  );

  it(
    'S3-06: throws an explicit invariant error when bootstrap_model is missing, and performs zero physical inventory mutation',
    async () => {
      const fixture = await createFixture('s3-06-invalid-bootstrap', null);

      await expect(
        withTenant(fixture.shopId, (trx) =>
          applyFulfillmentPhysicalRemoval(
            trx,
            fixture.shopId,
            fixture.orderId,
            new Date('2026-09-02T00:00:00.000Z')
          )
        )
      ).rejects.toThrow(/Unresolved bootstrap_model/);

      expect(await fulfillmentRemovals(fixture)).toHaveLength(0);

      expect(await warehouseLineStatus(fixture)).toBeUndefined();
    }
  );
});
