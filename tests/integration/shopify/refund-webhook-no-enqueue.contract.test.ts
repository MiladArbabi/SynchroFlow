// tests/integration/shopify/refund-webhook-no-enqueue.contract.test.ts
//
// STOCK-PROTECT-03 Slice 4 — a Shopify refund webhook must NEVER enqueue a
// Stock Protection snapshot job, and 'refunds/create' must never be added to
// isOrderEntityEvent. PERMANENT negative regression contract, authored as a
// BASELINE-GREEN GUARD.
// ===========================================================================
// BASELINE-GREEN GUARD, not required-RED: nothing enqueues shop_snapshot_jobs
// anywhere today, so this already passes — for the wrong reason (total
// absence of wiring, not a deliberate exclusion). Authored now so that once
// positive enqueue wiring lands elsewhere in Slice 4, this test continues to
// prove refunds are DELIBERATELY excluded, not merely still-uncovered. This
// is the single most consequential negative contract from the multi-pass
// Slice 4 audit — the refund/restock-authority question was resolved at
// length specifically to conclude this must stay false.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { handleRefundCreated } from 'api-src/api/shopify/handlers/handleRefundCreated';
import type { WebhookEnvelope } from 'api-src/api/webhooks/types';

const REPO = path.resolve(__dirname, '../../..');

async function createFixtureShop(unique: string): Promise<{ shopId: number; shopDomain: string }> {
  const shopDomain = `sp-refund-${unique}.myshopify.com`;
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-refund-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, (trx) =>
    trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shopDomain,
      access_token: 'test-token',
      scopes: 'read_orders,write_inventory',
    }),
  );

  // GH-1145-A1: bootstrap_model is required (migration 0193). This contract
  // covers the current legacy refund_return behaviour.
  await withTenant(shopId, (trx) =>
    trx('shop_wms_settings').insert({ shop_id: shopId, bootstrap_model: 'legacy_opening_balance_v1' }),
  );

  return { shopId, shopDomain };
}

async function seedVariantWithIdentityMap(shopId: number, externalVariantId: string) {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Refund fixture product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SKU-${variantId.slice(0, 8)}`,
      title: 'Refund fixture variant',
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
  });

  return variantId;
}

describe('Shopify refund webhook — never a Stock Protection trigger', () => {
  it('handleRefundCreated writes the financial refund_return ledger movement but never enqueues shop_snapshot_jobs and never touches inventory_truth', async () => {
    const { shopId, shopDomain } = await createFixtureShop(`webhook-${crypto.randomUUID().slice(0, 8)}`);
    const externalVariantId = String(crypto.randomInt(1_000_000, 9_999_999));
    const variantId = await seedVariantWithIdentityMap(shopId, externalVariantId);

    const envelope: WebhookEnvelope = {
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
            quantity: 2,
            restock_type: 'return',
            line_item: { variant_id: externalVariantId },
          },
        ],
      },
    };

    await withTenant(shopId, (trx) => handleRefundCreated(envelope, trx));

    // The financial ledger entry IS written — this is expected, correct
    // behavior, not the thing under test.
    const movement = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, movement_type: 'refund_return' })
        .first(),
    );
    expect(movement).toBeDefined();

    // inventory_truth must be untouched by the webhook alone.
    const truthRows = await withTenant(shopId, (trx) =>
      trx('inventory_truth').where({ shop_id: shopId, lasyncro_variant_id: variantId }).select('shop_id'),
    );
    expect(truthRows).toHaveLength(0);

    // No Stock Protection snapshot job was scheduled.
    const jobRow = await withTenant(shopId, (trx) =>
      trx('shop_snapshot_jobs').where({ shop_id: shopId }).first('shop_id'),
    );
    expect(jobRow).toBeUndefined();
  });

  it("'refunds/create' is not, and must never be, in projection.engine.ts's isOrderEntityEvent allowlist", () => {
    const source = fs.readFileSync(
      path.join(REPO, 'apps/backend/src/projection/projection.engine.ts'),
      'utf8',
    );
    const allowlistMatch = source.match(/isOrderEntityEvent\s*=\s*\[[\s\S]*?\]\.includes/);
    expect(allowlistMatch).not.toBeNull();
    expect(allowlistMatch![0]).not.toMatch(/refunds\/create/);
  });
});
