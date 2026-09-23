// tests/integration/shopify/refund-webhook-physicality-1145a.test.ts
//
// GH-1145-A1 REFUND-01 — a Shopify refund webhook is an economic assertion,
// not proof that stock physically came back to the warehouse.
//
//   - reconcile_opening_expectation_v2: the webhook must not create trusted
//     physical release capacity (no refund_return credit), while the refund
//     itself stays observable (domain_events row).
//   - legacy_opening_balance_v1: RT-04 behaviour unchanged in A1 (the
//     refund_return credit is still written).
//
// Physical return capacity for v2 comes from WMS return restock after
// physical execution, which is not touched here.

import crypto from 'crypto';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { handleRefundCreated } from 'api-src/api/shopify/handlers/handleRefundCreated';
import type { WebhookEnvelope } from 'api-src/api/webhooks/types';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { readReleaseCapacity } from 'api-src/services/inventory/releaseCapacity.service';

jest.setTimeout(120000);

type BootstrapModel =
  | 'legacy_opening_balance_v1'
  | 'reconcile_opening_expectation_v2';

async function createFixture(bootstrapModel: BootstrapModel) {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopDomain = `gh1145a-refund-${unique}.myshopify.com`;

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1145a-refund-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  const externalVariantId = String(crypto.randomInt(1_000_000, 9_999_999));

  await withTenant(shopId, async (trx) => {
    await trx('shop_wms_settings').insert({ shop_id: shopId, bootstrap_model: bootstrapModel });

    await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shopDomain,
      access_token: 'test-token',
      scopes: 'read_orders,write_inventory',
    });

    const warehouseId = crypto.randomUUID();
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'GH-1145-A refund warehouse',
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

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'GH-1145-A refund product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `GH1145A-R-${variantId.slice(0, 8)}`,
      title: 'GH-1145-A refund variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shopId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${crypto.randomInt(1_000_000, 9_999_999)}`,
      external_variant_id: `gid://shopify/ProductVariant/${externalVariantId}`,
    });

    // 2 units of genuine physical stock at root.
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      device_event_id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      movement_type: 'inbound_purchase',
      quantity_delta: 2,
      reference_type: 'test_fixture_receipt',
      reference_id: crypto.randomUUID(),
      platform: 'wms',
      location_code: rootCode,
      occurred_at: new Date(),
      triggered_by: 'test_fixture',
    });
  });

  return { shopId, shopDomain, variantId, externalVariantId };
}

function refundEnvelope(shopDomain: string, externalVariantId: string): WebhookEnvelope {
  return {
    integration: 'shopify',
    eventId: crypto.randomUUID(),
    eventType: 'refunds/create',
    verified: true,
    receivedAt: new Date(),
    shopDomain,
    rawPayload: {
      id: crypto.randomInt(1_000_000, 9_999_999),
      order_id: crypto.randomInt(1_000_000, 9_999_999),
      created_at: new Date().toISOString(),
      refund_line_items: [
        {
          quantity: 3,
          restock_type: 'return',
          line_item: { variant_id: externalVariantId },
        },
      ],
    },
  };
}

async function capacityAfterRebuild(shopId: number, variantId: string): Promise<number> {
  return withTenant(shopId, async (trx) => {
    await rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date());
    const rows = await readReleaseCapacity(trx, {
      shopId,
      variantIds: [variantId],
      lock: 'none',
    });
    return rows.reduce((sum, row) => sum + row.availableQuantity, 0);
  });
}

async function refundReturnCount(shopId: number, variantId: string): Promise<number> {
  const [{ count }] = await withTenant(shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, movement_type: 'refund_return' })
      .count<{ count: string }[]>('* as count')
  );
  return Number(count);
}

describe('GH-1145-A1 — Shopify refund webhook physicality', () => {
  it('REFUND-01: a v2 Shopify refund webhook does not increase release capacity, but the refund stays observable', async () => {
    const fixture = await createFixture('reconcile_opening_expectation_v2');
    const { shopId, variantId } = fixture;

    expect(await capacityAfterRebuild(shopId, variantId)).toBe(2);

    const envelope = refundEnvelope(fixture.shopDomain, fixture.externalVariantId);
    await withTenant(shopId, (trx) => handleRefundCreated(envelope, trx));

    expect(await refundReturnCount(shopId, variantId)).toBe(0);
    expect(await capacityAfterRebuild(shopId, variantId)).toBe(2);

    const domainEvent = await withTenant(shopId, (trx) =>
      trx('domain_events')
        .where({ shop_id: shopId, external_event_id: envelope.eventId, event_type: 'refunds/create' })
        .first('id')
    );
    expect(domainEvent).toBeDefined();
  });

  it('REFUND-LEGACY: a legacy tenant keeps the current refund_return credit in A1', async () => {
    const fixture = await createFixture('legacy_opening_balance_v1');
    const { shopId, variantId } = fixture;

    expect(await capacityAfterRebuild(shopId, variantId)).toBe(2);

    await withTenant(shopId, (trx) =>
      handleRefundCreated(refundEnvelope(fixture.shopDomain, fixture.externalVariantId), trx)
    );

    expect(await refundReturnCount(shopId, variantId)).toBe(1);
    expect(await capacityAfterRebuild(shopId, variantId)).toBe(5);
  });
});
