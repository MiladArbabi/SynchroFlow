import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { createShopifyGraphQLClient } from '../../services/shopify-client.factory.js';

const OPENING_BALANCE_NAMESPACE =
  '9f0e7b9c-6d4a-4e91-bc5e-2a1f8c7d3e44';

export async function seedShopifyOpeningBalances(
  trx: Knex.Transaction,
  accessToken: string,
  platformShopName: string,
  shopId: number
) {
  const client = createShopifyGraphQLClient(
    accessToken,
    platformShopName,
    shopId
  );

  const debug = await client.request(`
  query {
    products(first: 3) {
      edges {
        node {
          title
          variants(first: 3) {
            edges {
              node {
                id
                inventoryQuantity
                inventoryPolicy
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`);

console.log(JSON.stringify(debug.data, null, 2));

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

  console.log(JSON.stringify(response.data.products.edges[0].node.variants.edges[0].node.id));

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
