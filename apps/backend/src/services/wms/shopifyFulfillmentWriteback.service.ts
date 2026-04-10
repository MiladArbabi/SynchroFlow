// apps/backend/src/services/wms/shopifyFulfillmentWriteback.service.ts
import { Knex } from 'knex';
import { decrypt } from '../../security/encryption.service.js';
import { createShopifyGraphQLClient } from '../shopify/shopifyClient.service.js';

/**
 * SHOPIFY FULFILLMENT WRITEBACK (WM-20)
 * --------------------------------------
 * Called by shipConfirmation.service.ts after internal warehouse
 * status transitions complete.
 *
 * Pipeline:
 * 1. Resolve external_order_id from external_order_identity_map
 * 2. Resolve + decrypt access token from shopify_app_installations
 * 3. Fetch Shopify fulfillmentOrder ID via GraphQL
 * 4. Execute fulfillmentCreate mutation
 * 5. Persist shopify_fulfillment_id on order_warehouse_status
 *
 * Failure contract:
 * - Throws on missing identity, missing installation, or Shopify userErrors
 * - Caller (shipConfirmation) must decide whether to abort or log-and-continue
 * - shopify_fulfillment_id remains null if this throws — safe to retry
 *
 * Idempotency:
 * - Shopify fulfillmentCreateV2 is idempotent if fulfillmentOrder already fulfilled
 * - shopify_fulfillment_id update uses WHERE shopify_fulfillment_id IS NULL guard
 */
export async function writeShopifyFulfillment(
  trx: Knex.Transaction,
  params: {
    lasyncroOrderId: string;
    shopId: number;
  }
): Promise<void> {
  const { lasyncroOrderId, shopId } = params;

  // 1. Resolve external_order_id
  const identity = await trx('external_order_identity_map')
    .where({ lasyncro_order_id: lasyncroOrderId, shop_id: shopId })
    .select('external_order_id')
    .first();

  if (!identity?.external_order_id) {
    throw new Error(
      `[WMS_WRITEBACK] No external_order_id for order: ${lasyncroOrderId}`
    );
  }

  // 2. Resolve + decrypt access token
  const installation = await trx('shopify_app_installations')
    .where({ shop_id: shopId })
    .select('shop_domain', 'access_token')
    .first();

  if (!installation?.access_token || !installation?.shop_domain) {
    throw new Error(
      `[WMS_WRITEBACK] No Shopify installation for shop: ${shopId}`
    );
  }

  const accessToken = decrypt(
    installation.access_token,
    'wms.shipConfirmation.writeback'
  );

  const client = createShopifyGraphQLClient({
    accessToken,
    platformShopName: installation.shop_domain,
    shopId,
  });

  // 3. Fetch fulfillmentOrder ID
  const orderGid = `gid://shopify/Order/${identity.external_order_id}`;

  const foResponse: any = await client.request(
    `query ($orderId: ID!) {
      order(id: $orderId) {
        fulfillmentOrders(first: 10) {
          edges {
            node {
              id
              status
            }
          }
        }
      }
    }`,
    { variables: { orderId: orderGid } }
  );

  const fulfillmentOrderEdges: any[] =
    foResponse?.data?.order?.fulfillmentOrders?.edges ?? [];

  // Filter to open fulfillment orders only — skip already-fulfilled
  const openEdges = fulfillmentOrderEdges.filter(
    (e: any) => e.node.status !== 'CLOSED' && e.node.status !== 'CANCELLED'
  );

  if (openEdges.length === 0) {
    console.info('[WMS_WRITEBACK] No open fulfillmentOrders — already fulfilled in Shopify', {
      lasyncroOrderId,
      shopId,
    });
    return;
  }

  // 4. Execute fulfillmentCreateV2 mutation (Shopify API 2024-01+)
  const fulfillmentResponse: any = await client.request(
    `mutation ($fulfillment: FulfillmentV2Input!) {
      fulfillmentCreateV2(fulfillment: $fulfillment) {
        fulfillment { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        fulfillment: {
          lineItemsByFulfillmentOrder: openEdges.map((e: any) => ({
            fulfillmentOrderId: e.node.id,
          })),
        },
      },
    }
  );

  const userErrors =
    fulfillmentResponse?.data?.fulfillmentCreateV2?.userErrors;

  if (userErrors?.length > 0) {
    throw new Error(
      `[WMS_WRITEBACK] Shopify fulfillmentCreateV2 userErrors: ${JSON.stringify(userErrors)}`
    );
  }

  const shopifyFulfillmentId =
    fulfillmentResponse?.data?.fulfillmentCreateV2?.fulfillment?.id ?? null;

  // 5. Persist shopify_fulfillment_id — guard prevents overwrite on retry
  if (shopifyFulfillmentId) {
    await trx('order_warehouse_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .whereNull('shopify_fulfillment_id')
      .update({ shopify_fulfillment_id: shopifyFulfillmentId });
  }

  console.info('[WMS_WRITEBACK_COMPLETE]', {
    lasyncroOrderId,
    shopId,
    shopifyFulfillmentId,
  });
}