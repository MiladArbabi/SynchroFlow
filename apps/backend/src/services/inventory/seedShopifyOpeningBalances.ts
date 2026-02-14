import { Knex } from 'knex';
import { createShopifyGraphQLClient } from '../shopify-client.factory';

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

  for (const p of response.data.products.edges) {
    for (const v of p.node.variants.edges) {
      const shopifyVariantId = v.node.id;
      const qty = v.node.inventoryQuantity ?? 0;

      if (qty === 0) continue;

      const mapping = await trx('external_product_identity_map')
        .where({
          shop_id: shopId,
          external_variant_id: shopifyVariantId,
        })
        .first();

      if (!mapping) continue;

      await trx('inventory_movements')
        .insert({
          lasyncro_inventory_movement_id: crypto.randomUUID(),
          lasyncro_variant_id: mapping.lasyncro_variant_id,
          movement_type: 'manual_adjustment',
          quantity_delta: qty,
          reference_type: 'opening_balance',
          reference_id: `shopify-${shopifyVariantId}`,
          platform: 'shopify',
          occurred_at: new Date(),
        })
        .onConflict(['reference_type', 'reference_id', 'lasyncro_variant_id'])
        .ignore();
    }
  }
}
