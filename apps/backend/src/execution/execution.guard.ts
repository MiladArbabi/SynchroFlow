/**
 * EXECUTION GUARD (PHASE 1)
 * -------------------------
 * Central validation layer before execution.
 *
 * Purpose:
 * - Prevent unsafe execution
 * - Provide single extension point for future rules
 *
 * Current checks:
 * - decision_execution_queue state validation
 */

import db from '@lasyncro/backend-core/db.js';
import { ExecutionJob } from '../domain/decision/Decision.js';
import { createShopifyGraphQLClient } from '../services/shopify/shopifyClient.service.js';
import { resolveExternalOrderId } from '../services/identity/resolveExternalOrder.service.js';
import { decrypt } from '../security/encryption.service.js';

export async function validateExecution(
  job: ExecutionJob,
  trx?: any
): Promise<void> {
  const q = trx ?? db;

  const row = await q('decision_execution_queue')
    .where({ decision_id: job.decision_id })
    .first();

  /**
   * HARD BLOCKS
   */
  if (row) {
    if (row.status === 'success') {
      console.warn('[EXECUTION_GUARD_BLOCK_SUCCESS]', {
        decision_id: job.decision_id
      });
      throw new Error('EXECUTION_ALREADY_SUCCESS');
    }

    if (row.status === 'failure') {
      console.warn('[EXECUTION_GUARD_BLOCK_FAILED]', {
        decision_id: job.decision_id
      });
      throw new Error('EXECUTION_ALREADY_FAILED');
    }
  }

  /**
 * EXTERNAL VALIDATION — SHOPIFY (CRITICAL)
 * ----------------------------------------
 * Prevent executing fulfillment if already fulfilled externally.
 */
if (job.action_type === 'proceed_fulfillment') {

  const installation = await q('shopify_app_installations')
    .where({ shop_id: job.shop_id })
    .first();

if (!installation) {
  console.warn('[EXECUTION_GUARD_BLOCK_NO_INSTALLATION]', {
    shop_id: job.shop_id,
    decision_id: job.decision_id
  });
  throw new Error('SHOPIFY_INSTALLATION_NOT_FOUND');
}

if (!installation.access_token || !installation.shop_domain) {
  console.error('[EXECUTION_GUARD_INVALID_INSTALLATION]', {
    shop_id: job.shop_id,
    decision_id: job.decision_id
  });
  throw new Error('INVALID_SHOPIFY_INSTALLATION');
}

/**
 * TOKEN DECRYPTION (CRITICAL)
 * --------------------------
 * - Must use central encryption service
 * - Context tag ensures audit traceability
 */
const accessToken = decrypt(installation.access_token, 'execution.guard');

const client = createShopifyGraphQLClient({
  accessToken,
  platformShopName: installation.shop_domain,
  shopId: job.shop_id
});

  /**
   * SIGNATURE: resolveExternalOrderId(shopId, platform, lasyncroOrderId, trx?)
   * - job.entity_id is the lasyncro_order_id (internal order UUID)
   * - job.shop_id is number (integer) — matches DB + RLS
   */
  const externalOrderId = await resolveExternalOrderId(job.shop_id, 'shopify', job.entity_id, trx);
    if (!externalOrderId) {
    console.warn('[EXECUTION_GUARD_BLOCK_NO_EXTERNAL_ID]', {
        decision_id: job.decision_id
    });
    throw new Error('EXTERNAL_ORDER_ID_NOT_FOUND');
    }

    const orderGid = `gid://shopify/Order/${externalOrderId}`;

  const response: any = await client.query({
    data: {
      query: `
        query ($id: ID!) {
          order(id: $id) {
            fulfillmentOrders(first: 10) {
              edges {
                node {
                  lineItems(first: 10) {
                    edges {
                      node {
                        remainingQuantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      variables: { id: orderGid }
    }
  });

  const edges =
    response?.body?.data?.order?.fulfillmentOrders?.edges ?? [];

  const totalRemaining = edges.reduce((sum: number, edge: any) => {
    const quantities =
      edge.node?.lineItems?.edges?.map((e: any) => e.node.remainingQuantity) ?? [];

    return sum + quantities.reduce((s: number, q: number) => s + q, 0);
  }, 0);

  if (totalRemaining === 0) {
    console.warn('[EXECUTION_GUARD_BLOCK_SHOPIFY_ALREADY_FULFILLED]', {
      decision_id: job.decision_id
    });

    throw new Error('SHOPIFY_ALREADY_FULFILLED');
  }
}

  /**
   * FUTURE EXTENSIONS:
   * - external state validation (Shopify)
   * - decision freshness
   * - circuit breaker
   */
}