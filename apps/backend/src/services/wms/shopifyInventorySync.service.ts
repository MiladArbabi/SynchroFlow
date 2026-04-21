// apps/backend/src/services/wms/shopifyInventorySync.service.ts
//
// SHOPIFY INVENTORY SYNC (CASCADE-03)
// -------------------------------------
// Called after stow confirmation to push accepted quantity delta to Shopify.
//
// Uses inventoryAdjustQuantities mutation (API 2024-01+):
//   - Delta-based: adds quantity, never sets absolute — safe under concurrent operations
//   - Requires write_inventory scope (added to REQUIRED_SCOPES)
//   - Requires external_inventory_item_id from external_product_identity_map
//   - Requires external_location_id from warehouse_locations
//
// Failure contract:
//   - Throws on missing identity, missing installation, or Shopify userErrors
//   - Caller logs and continues — Shopify sync failure MUST NOT block stow confirmation
//   - Retry is safe: delta idempotency handled at caller (quantity only sent once per stow task)
//
// Called by: httpConfirmStow in wms.controller.ts

import { Knex } from 'knex';
import { decrypt } from '../../security/encryption.service.js';
import { createShopifyGraphQLClient } from './../shopify/shopifyClient.service.js';

const INVENTORY_ADJUST_MUTATION = `
  mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
        reason
        changes {
          name
          delta
          quantityAfterChange
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function syncStowedQuantityToShopify(
  trx: Knex.Transaction,
  params: {
    shopId: number;
    lasyncroVariantId: string;
    locationCode: string;
    quantityDelta: number; // positive — units stowed
  }
): Promise<void> {
  const { shopId, lasyncroVariantId, locationCode, quantityDelta } = params;

  if (quantityDelta <= 0) return;

  // 1. Resolve Shopify inventory_item_id for this variant
  const identity = await trx('external_product_identity_map')
    .where({ lasyncro_variant_id: lasyncroVariantId, shop_id: shopId })
    .select('external_inventory_item_id')
    .first();

  if (!identity?.external_inventory_item_id) {
    throw new Error(
      `[SHOPIFY_INV_SYNC] No external_inventory_item_id for variant: ${lasyncroVariantId}`
    );
  }

  // 2. Resolve Shopify location_id for this warehouse location
  const location = await trx('warehouse_locations')
    .where({ location_code: locationCode, shop_id: shopId })
    .select('external_location_id')
    .first();

  if (!location?.external_location_id) {
    throw new Error(
      `[SHOPIFY_INV_SYNC] No external_location_id for location: ${locationCode}`
    );
  }

  // 3. Resolve + decrypt Shopify access token
  const installation = await trx('shopify_app_installations')
    .where({ shop_id: shopId })
    .select('shop_domain', 'access_token')
    .first();

  if (!installation?.access_token || !installation?.shop_domain) {
    throw new Error(
      `[SHOPIFY_INV_SYNC] No Shopify installation for shop: ${shopId}`
    );
  }

  const accessToken = decrypt(
    installation.access_token,
    'wms.stow.inventorySync'
  );

  const client = createShopifyGraphQLClient({
    accessToken,
    platformShopName: installation.shop_domain,
    shopId,
  });

  // 4. Push delta to Shopify — delta-based, safe under concurrent ops
  const response: any = await client.request(INVENTORY_ADJUST_MUTATION, {
    variables: {
      input: {
        reason: 'received',
        name: 'available',
        changes: [
          {
            inventoryItemId: `gid://shopify/InventoryItem/${identity.external_inventory_item_id}`,
            locationId: `gid://shopify/Location/${location.external_location_id}`,
            delta: quantityDelta,
          },
        ],
      },
    },
  });

  const userErrors = response?.data?.inventoryAdjustQuantities?.userErrors;
  if (userErrors?.length > 0) {
    throw new Error(
      `[SHOPIFY_INV_SYNC] userErrors: ${JSON.stringify(userErrors)}`
    );
  }

  console.info('[SHOPIFY_INV_SYNC_COMPLETE]', {
    shopId,
    lasyncroVariantId,
    locationCode,
    quantityDelta,
    changes: response?.data?.inventoryAdjustQuantities?.inventoryAdjustmentGroup?.changes,
  });
}