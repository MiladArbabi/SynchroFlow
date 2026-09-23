import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { createShopifyGraphQLClient } from '../../services/shopify-client.factory.js';
import { resolveBootstrapModel } from './bootstrapModel.js';

const OPENING_BALANCE_NAMESPACE =
  '9f0e7b9c-6d4a-4e91-bc5e-2a1f8c7d3e44';

/**
 * Minimal Shopify GraphQL client shape this seeder depends on. The real
 * `createShopifyGraphQLClient(...)` return value satisfies it. Tests may pass a
 * deterministic stub via the optional trailing `injectedClient` arg — production
 * callers pass nothing and get the real factory client unchanged.
 */
type ShopifyGraphqlLike = {
  // `data` is optional to match @shopify/shopify-api's GraphQLClientResponse.
  request: (query: string, opts?: any) => Promise<{ data?: any }>;
};

export async function seedShopifyOpeningBalances(
  trx: Knex.Transaction,
  accessToken: string,
  platformShopName: string,
  shopId: number,
  injectedClient?: ShopifyGraphqlLike
) {
  const client: ShopifyGraphqlLike =
    injectedClient ??
    createShopifyGraphQLClient(accessToken, platformShopName, shopId);

  const response = await client.request(`
  query {
    products(first: 50) {
      edges {
        node {
          variants(first: 100) {
            edges {
              node {
                id
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }
`);

  /**
   * ZERO-VARIANT SHORT CIRCUIT
   * --------------------------
   * A valid response with no variants has nothing to bootstrap under either
   * model, so the bootstrap_model read below is not required.
   */
  const totalVariantCount = response.data.products.edges.reduce(
    (sum: number, p: any) => sum + p.node.variants.edges.length,
    0
  );

  if (totalVariantCount === 0) {
    return;
  }

  /**
   * BOOTSTRAP MODEL (GH-1145-A1)
   * ----------------------------
   * shop_wms_settings.bootstrap_model (migration 0193) is the sole source of
   * which path runs — never inferred from existing movements, expectations
   * or inventory state. Missing or unknown value FAILS CLOSED.
   */
  const bootstrapModel = await resolveBootstrapModel(trx, shopId);

  if (bootstrapModel === 'reconcile_opening_expectation_v2') {
    await seedOpeningExpectationsV2(trx, shopId, response);
    return;
  }

  // legacy_opening_balance_v1 — unchanged below.
  let missingMappings = 0;

  for (const p of response.data.products.edges) {
    for (const v of p.node.variants.edges) {
      const shopifyVariantId = v.node.id;
      const rawQty = v.node.inventoryQuantity ?? 0;

      /**
       * OPENING BALANCE INVARIANT
       * -------------------------
       * Shopify inventoryQuantity may be negative when
       * the platform allows overselling.
       *
       * Opening balances must never be negative because
       * they represent initial stock, not adjustments.
       *
       * Negative values are normalized to zero and
       * inventory deficit will be represented by
       * subsequent sale movements.
       */
      const qty = Math.max(0, rawQty ?? 0);

      const mapping = await trx('external_product_identity_map')
        .where({
          shop_id: shopId,
          external_variant_id: shopifyVariantId,
        })
        .first();

      if (!mapping) {
        missingMappings++;
        console.error('[INVENTORY_OPENING_BALANCE_MAPPING_MISSING]', {
          shopId,
          shopifyVariantId,
        });

        /**
         * CRITICAL INVARIANT VIOLATION
         * ----------------------------
         * Opening balance cannot be seeded without identity mapping.
         * This indicates ingestion ordering or data integrity failure.
         *
         * We DO NOT silently skip — this must be visible.
         */
        continue;
      }

      if (missingMappings > 0) {
        console.error('[INVENTORY_OPENING_BALANCE_SUMMARY]', {
          shopId,
          missingMappings,
        });
      }

      /**
       * ZERO BASELINE HANDLING
       * ----------------------
       * Zero inventory is a VALID initial state.
       * We must explicitly represent it to avoid:
       * - missing variants in projection
       * - implicit "unknown" state
       */
      if (qty === 0) {
        console.info('[INVENTORY_OPENING_BALANCE_ZERO_RECORDED]', {
          shopId,
          shopifyVariantId,
          lasyncroVariantId: mapping.lasyncro_variant_id
        });

        await trx('inventory_movements')
          .insert({
            lasyncro_inventory_movement_id: crypto.randomUUID(),
            device_event_id: uuidv5(
              `${shopId}:${mapping.lasyncro_variant_id}:opening_balance_zero`,
              OPENING_BALANCE_NAMESPACE
            ),
            shop_id: shopId,
            lasyncro_variant_id: mapping.lasyncro_variant_id,
            movement_type: 'opening_balance',
            quantity_delta: 0,
            reference_type: 'opening_balance',
            reference_id: crypto.randomUUID(),
            platform: 'shopify',
            location_code: `WH-${shopId}-ROOT`,
            occurred_at: new Date(),
            triggered_by: 'system', // traceability: Shopify opening balance sync
          })
          .onConflict(['device_event_id'])
          .ignore();

        continue;
      }

      await trx('inventory_movements')
        .insert({
          lasyncro_inventory_movement_id: crypto.randomUUID(),
          device_event_id: uuidv5(
            `${shopId}:${mapping.lasyncro_variant_id}:opening_balance`,
            OPENING_BALANCE_NAMESPACE
          ),
          shop_id: shopId,
          lasyncro_variant_id: mapping.lasyncro_variant_id,
          movement_type: 'opening_balance',
          quantity_delta: qty,
          reference_type: 'opening_balance',
          reference_id: crypto.randomUUID(),
          platform: 'shopify',
          location_code: `WH-${shopId}-ROOT`,
          occurred_at: new Date(),
          triggered_by: 'system', // traceability: Shopify opening balance sync
        })
        .onConflict(['device_event_id'])
        .ignore();
    }
  }
}

/**
 * V2 PATH — reconcile_opening_expectation_v2 (GH-1145-A1)
 * -------------------------------------------------------
 * Shopify inventoryQuantity is an opening EXPECTATION only: one row per
 * variant in shopify_opening_inventory_expectations. ZERO inventory_movements,
 * therefore ZERO inventory_truth and ZERO release capacity.
 *
 * ATOMIC: every reported variant is resolved to a lasyncro_variant_id before
 * anything is written; one unmapped variant rejects the whole snapshot (the
 * legacy skip-and-log behaviour is unchanged).
 *
 * IDEMPOTENT, FIRST SNAPSHOT WINS (shop level): if any row already exists
 * for this shop the attempt writes nothing, so a retry whose response gained
 * a variant cannot append it at a later observed_at. onConflict().ignore()
 * on UNIQUE(shop_id, lasyncro_variant_id) is defence in depth.
 */
async function seedOpeningExpectationsV2(
  trx: Knex.Transaction,
  shopId: number,
  response: { data?: any }
): Promise<void> {
  const existingRow = await trx('shopify_opening_inventory_expectations')
    .where({ shop_id: shopId })
    .first('shop_id');

  if (existingRow) {
    return;
  }

  const observedAt = new Date();
  const rowsToInsert: Array<{
    shop_id: number;
    lasyncro_variant_id: string;
    external_variant_id: string;
    reported_quantity: number;
    expected_quantity: number;
    observed_at: Date;
  }> = [];

  for (const p of response.data.products.edges) {
    for (const v of p.node.variants.edges) {
      const shopifyVariantId = v.node.id;
      const reportedQuantity = v.node.inventoryQuantity ?? 0;

      const mapping = await trx('external_product_identity_map')
        .where({
          shop_id: shopId,
          external_variant_id: shopifyVariantId,
        })
        .first();

      if (!mapping) {
        console.error('[INVENTORY_OPENING_EXPECTATION_MAPPING_MISSING]', {
          shopId,
          shopifyVariantId,
        });

        throw new Error(
          `[SEED_SHOPIFY_OPENING_EXPECTATIONS_V2] Unmapped Shopify variant for shop_id=${shopId}, shopifyVariantId=${shopifyVariantId}. Rejecting entire v2 opening-inventory snapshot.`
        );
      }

      rowsToInsert.push({
        shop_id: shopId,
        lasyncro_variant_id: mapping.lasyncro_variant_id,
        external_variant_id: shopifyVariantId,
        reported_quantity: reportedQuantity,
        // Same never-negative normalization as the legacy opening balance.
        expected_quantity: Math.max(0, reportedQuantity),
        observed_at: observedAt,
      });
    }
  }

  await trx('shopify_opening_inventory_expectations')
    .insert(rowsToInsert)
    .onConflict(['shop_id', 'lasyncro_variant_id'])
    .ignore();
}
