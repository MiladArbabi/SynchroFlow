// apps/backend/src/services/order-identity-guard.service.ts
import type { Knex } from 'knex';
import { createShopifyGraphQLClient } from './shopify-client.factory.js';
import { decrypt } from '../security/encryption.service.js';
// CENTRALIZED DECRYPTION
// NOTE: Delegates to encryption.service (single source of truth)
function decryptToken(encrypted: string): string {
  return decrypt(encrypted, 'order-identity-guard');
}
/**
 * ENSURE ORDER IDENTITY EXISTS
 * ----------------------------
 * Hard invariant:
 * Fulfillment must never enter system before
 * order baseline exists.
 *
 * If identity mapping missing:
 * - Fetch order via Shopify GraphQL
 * - Emit orders/sync domain event
 *
 * Deterministic, replay-safe.
 *
 * ISS-RLS2: trx is REQUIRED — caller must pass its tenant-scoped
 * transaction (SET LOCAL app.current_tenant already applied).
 */
export async function ensureOrderIdentityExists(
  shopId: number,
  shopDomain: string,
  externalOrderNumericId: string,
  trx: Knex.Transaction
): Promise<void> {
  const existing = await trx('external_order_identity_map')
    .where({
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderNumericId,
    })
    .first();
  if (existing) return;
  const installation = await trx('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .first();
  if (!installation) {
    throw new Error('[IDENTITY_GUARD_INSTALLATION_NOT_FOUND]');
  }
  const gid = `gid://shopify/Order/${externalOrderNumericId}`;
  const accessToken = decryptToken(installation.access_token);
  const client = createShopifyGraphQLClient(
    accessToken,
    shopDomain,
    shopId
  );
  const response = await client.request(`
    query ($id: ID!) {
      order(id: $id) {
        id
        createdAt
        updatedAt
        processedAt
        currencyCode
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        sourceName
        lineItems(first: 100) {
          edges {
            node {
              id
              title
              quantity
              sku
              originalTotalSet { shopMoney { amount } }
              discountedTotalSet { shopMoney { amount } }
              originalUnitPriceSet { shopMoney { amount } }
              discountedUnitPriceSet { shopMoney { amount } }
              product { id }
              variant { id sku }
            }
          }
        }
      }
    }
  `, {
      variables: { id: gid },
    }
 );
  const node = response?.data?.order;
  if (!node) {
    throw new Error('[IDENTITY_GUARD_ORDER_NOT_FOUND_IN_SHOPIFY]');
  }
  try {
    await trx('domain_events').insert({
      shop_id: shopId,
      event_type: 'orders/sync',
      /**
       * CANONICAL ORDER PAYLOAD (IDENTITY GUARD)
       * ----------------------------------------
       * Must normalize Shopify GID → numeric ID.
       *
       * CRITICAL:
       * - Prevents violation of domain_events_no_gid_check
       * - Keeps ingestion consistent with sync service
       * - Ensures deterministic replay
       */
      event_payload: {
        ...node,
        id: (() => {
          let id = String(node.id);
          if (id.startsWith('gid://')) {
            id = id.split('/').pop()!;
          }
          return id;
        })(),
      },
      event_time: new Date(node.createdAt),
      event_version: 1,
      /**
       * EXTERNAL EVENT ID NORMALIZATION (GID → NUMERIC)
       */
      external_event_id: (() => {
        let id = String(node.id);
        if (id.startsWith('gid://')) {
          id = id.split('/').pop()!;
        }
        return id;
      })(),
    });
  } catch (err: any) {
    if (err?.code === '23505') {
      // idempotent duplicate
      return;
    }
    throw err;
  }
}
