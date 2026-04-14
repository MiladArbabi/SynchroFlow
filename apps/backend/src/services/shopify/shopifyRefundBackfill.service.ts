// apps/backend/src/services/shopify/shopifyRefundBackfill.service.ts

/**
 * SHOPIFY REFUND BACKFILL SERVICE
 * --------------------------------
 * Fetches historical refunds from Shopify REST API
 * and emits refunds/create domain events for projection.
 *
 * Use case:
 * - Refunds that predate app installation are never sent via webhook.
 * - This service closes the gap by querying Shopify per-order.
 *
 * Guarantees:
 * - Idempotent — domain_events has unique constraint on external_event_id
 * - Shop-scoped — never crosses tenant boundary
 * - Read-only from Shopify — no mutations
 *
 * Trigger:
 * - Called once manually via CLI or admin endpoint after installation.
 */

import db from '@lasyncro/backend-core/db.js';
import { decrypt } from '../../security/encryption.service.js';
import { createShopifyGraphQLClient } from './shopifyClient.service.js';

const REFUNDS_QUERY = `
query getOrderRefunds($orderId: ID!) {
  order(id: $orderId) {
    id
    refunds {
      id
      createdAt
      refundLineItems(first: 50) {
        edges {
          node {
            quantity
            subtotal
            restockType
            lineItem {
              id
              variant { id }
            }
          }
        }
      }
    }
  }
}
`;

/**
 * backfillShopifyRefunds
 * ----------------------
 * Iterates all orders for a shop, fetches their Shopify refunds,
 * and emits domain events for any not yet ingested.
 */
export async function backfillShopifyRefunds(shopId: number): Promise<{
  processed: number;
  skipped: number;
  errors: number;
}> {

  const integration = await db('integrations')
    .where({ shop_id: shopId, platform: 'shopify' })
    .select('access_token_encrypted', 'platform_shop_name')
    .first();

  if (!integration?.access_token_encrypted) {
    throw new Error(`[REFUND_BACKFILL] No access token for shop ${shopId}`);
  }

  const accessToken = decrypt(integration.access_token_encrypted, 'shopify-token-backfill');

  const client = createShopifyGraphQLClient({
    accessToken,
    platformShopName: integration.platform_shop_name,
    shopId,
  });

  // Fetch all external order IDs for this shop
  const orderRows = await db('external_order_identity_map')
    .where({ shop_id: shopId, platform: 'shopify' })
    .select('external_order_id');

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const { external_order_id } of orderRows) {
    try {
      const gid = `gid://shopify/Order/${external_order_id}`;

      const response = await client.request(REFUNDS_QUERY, {
        variables: { orderId: gid },
      });

      const refunds = (response as any)?.data?.order?.refunds ?? [];

      for (const refund of refunds) {
        const externalRefundId = String(refund.id).split('/').pop();
        const externalEventId = `shopify:refunds/create:${externalRefundId}`;

        const refundLineItems = (refund.refundLineItems?.edges ?? []).map(
          (e: any) => ({
            quantity: e.node.quantity,
            subtotal: e.node.subtotal,
            restock_type: e.node.restockType?.toLowerCase() ?? 'no_restock',
            line_item: {
                // Preserve full GID — order_line_items.external_line_item_id stores GID format
                id: e.node.lineItem?.id ?? null,
                variant_id: e.node.lineItem?.variant?.id?.split('/').pop() ?? null,
            },
          })
        );

        try {
          await db('domain_events').insert({
            shop_id: shopId,
            event_type: 'refunds/create',
            event_payload: {
              id: externalRefundId,
              order_id: external_order_id,
              created_at: refund.createdAt,
              refund_line_items: refundLineItems,
            },
            event_time: new Date(refund.createdAt),
            event_version: 1,
            external_event_id: externalEventId,
          });

          processed++;

          console.info('[REFUND_BACKFILL_EVENT_WRITTEN]', {
            shopId,
            externalRefundId,
            external_order_id,
          });
        } catch (err: any) {
          if (err?.code === '23505') {
            // Already ingested — idempotent skip
            skipped++;
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      console.error('[REFUND_BACKFILL_ORDER_FAILED]', {
        shopId,
        external_order_id,
        error: (err as Error).message,
      });
      errors++;
    }
  }

  console.info('[REFUND_BACKFILL_COMPLETE]', { shopId, processed, skipped, errors });
  return { processed, skipped, errors };
}