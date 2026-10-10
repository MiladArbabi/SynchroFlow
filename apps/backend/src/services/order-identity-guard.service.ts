import type { Knex } from 'knex';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { createShopifyGraphQLClient } from './shopify-client.factory.js';
import { resolveShopifyAdminCredentialForConsumer } from './shopify/shopifyAdminCredentialConsumer.service.js';

/** Router-owned tenant transaction: durable evidence only, without provider I/O. */
export async function ensureOrderIdentityExists(
  shopId: number,
  externalOrderNumericId: string,
  trx: Knex.Transaction
): Promise<void> {
  const existing = await trx('external_order_identity_map')
    .where({ shop_id: shopId, platform: 'shopify', external_order_id: externalOrderNumericId })
    .first('lasyncro_order_id');
  if (existing) return;

  const baseline = await trx('domain_events')
    .where({ shop_id: shopId, event_type: 'orders/sync', external_event_id: externalOrderNumericId })
    .first('id');
  if (baseline) return;

  throw new Error('ORDER_IDENTITY_RECOVERY_REQUIRED');
}

function normalizeOrderId(value: unknown): string {
  const match = typeof value === 'string'
    ? /^(?:gid:\/\/shopify\/Order\/)?([1-9][0-9]*)$/.exec(value)
    : null;
  if (!match) throw new Error('ORDER_IDENTITY_RECOVERY_RETRYABLE');
  return match[1];
}

/** Recovery assistance after the failed delivery commits; never owns its ledger. */
export async function recoverOrderIdentityAfterCommit(
  params: { shopId: number; externalOrderNumericId: string }
): Promise<void> {
  const { shopId } = params;
  const externalOrderNumericId = normalizeOrderId(params.externalOrderNumericId);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new Error('ORDER_IDENTITY_RECOVERY_RETRYABLE');
  }

  const alreadyDurable = await withTenant(shopId, async (trx) => {
    const identity = await trx('external_order_identity_map')
      .where({ shop_id: shopId, platform: 'shopify', external_order_id: externalOrderNumericId })
      .first('lasyncro_order_id');
    if (identity) return true;
    const baseline = await trx('domain_events')
      .where({ shop_id: shopId, event_type: 'orders/sync', external_event_id: externalOrderNumericId })
      .first('id');
    return !!baseline;
  });
  if (alreadyDurable) return;

  const credential = await resolveShopifyAdminCredentialForConsumer({ shopId, now: new Date() });
  switch (credential.kind) {
    case 'REFRESH_IN_PROGRESS': throw new Error('SHOPIFY_CREDENTIAL_REFRESH_IN_PROGRESS');
    case 'RETRYABLE': throw new Error('SHOPIFY_CREDENTIAL_RETRYABLE');
    case 'PROVIDER_REJECTED': throw new Error('SHOPIFY_CREDENTIAL_PROVIDER_REJECTED');
    case 'REAUTH_REQUIRED': throw new Error('SHOPIFY_CREDENTIAL_REAUTH_REQUIRED');
  }

  // Both the prerequisite read and credential lifecycle transactions are closed.
  let response;
  try {
    const client = createShopifyGraphQLClient(credential.accessToken, credential.shopDomain, shopId);
    response = await client.request(`
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
      variables: { id: `gid://shopify/Order/${externalOrderNumericId}` },
    });
  } catch {
    throw new Error('ORDER_IDENTITY_RECOVERY_RETRYABLE');
  }

  if (!response?.data || response.errors) {
    throw new Error('ORDER_IDENTITY_RECOVERY_RETRYABLE');
  }
  const node = response.data.order;
  if (node === null) throw new Error('IDENTITY_GUARD_ORDER_NOT_FOUND_IN_SHOPIFY');
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error('ORDER_IDENTITY_RECOVERY_RETRYABLE');
  }
  const normalizedId = normalizeOrderId(node.id);
  if (normalizedId !== externalOrderNumericId || typeof node.createdAt !== 'string' || !node.createdAt) {
    throw new Error('ORDER_IDENTITY_RECOVERY_RETRYABLE');
  }
  const eventTime = new Date(node.createdAt);
  if (!Number.isFinite(eventTime.getTime())) throw new Error('ORDER_IDENTITY_RECOVERY_RETRYABLE');

  await withTenant(shopId, async (trx) => {
    await trx('domain_events').insert({
      shop_id: shopId,
      event_type: 'orders/sync',
      event_payload: { ...node, id: normalizedId },
      event_time: eventTime,
      event_version: 1,
      external_event_id: normalizedId,
    }).onConflict(trx.raw('(shop_id, external_event_id) WHERE external_event_id IS NOT NULL')).ignore();
  });
}
