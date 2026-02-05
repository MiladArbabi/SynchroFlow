/**
 * @deprecated
 * Returns enrichment is disabled.
 * Refunds ingestion is the single source of truth.
 */

// apps/backend/src/workers/returnsEnrichment.worker.ts

import db from 'api-src/db';
import axios from 'axios';
import { getQueueChannel } from 'api-src/queue';
import { ShopifyAppService } from '../services/shopify-app.service';

const MAX_ATTEMPTS = 4;

function computeBackoff(attempt: number): string | null {
  switch (attempt) {
    case 1: return '5 minutes';
    case 2: return '30 minutes';
    case 3: return '2 hours';
    default: return null;
  }
}

export async function processReturnEnrichment(msg: any) {
  const { canonical_return_id } = JSON.parse(msg.content.toString());

  await db.transaction(async trx => {
    const ret = await trx('canonical_returns')
      .where({ canonical_return_id })
      .forUpdate()
      .first();

    console.log('[returns-enrichment][debug] loaded return:', {
        canonical_return_id,
        exists: !!ret,
        status: ret?.enrichment_status,
        attempts: ret?.enrichment_attempts,
        next_at: ret?.next_enrichment_at,
    });

    if (!ret) {
        console.log('[returns-enrichment][exit] return_not_found');
        getQueueChannel('returns.enrichment.v1').ack(msg);
        return;
    }

    if (ret.enrichment_status === 'enriched') {
        console.log('[returns-enrichment][exit] already_enriched');
        getQueueChannel('returns.enrichment.v1').ack(msg);
        return;
    }

    if (
        ret.enrichment_attempts >= MAX_ATTEMPTS ||
        (ret.next_enrichment_at &&
            new Date(ret.next_enrichment_at) > new Date())
        ) {
        console.log('[returns-enrichment][exit] exhausted_or_backoff', {
            attempts: ret.enrichment_attempts,
            next_at: ret.next_enrichment_at,
        });

        getQueueChannel('returns.enrichment.v1').ack(msg);
        return;
    }

    const creds =
    await ShopifyAppService.getDecryptedAccessTokenByShopId(
        ret.shop_id
    );

    if (!creds) {
        throw new Error('Shop credentials unavailable');
    }

    const { token, shopDomain } = creds;

    // TEMP DEBUG — REMOVE AFTER VERIFICATION
    console.log('[returns-enrichment][debug] shopDomain:', shopDomain);
    console.log('[returns-enrichment][debug] token length:', token?.length);

    try {
     /**
     * Shopify Returns enrichment — deterministic (Option A)
     * -----------------------------------------------------
     * Shopify does NOT expose SKU on ReturnLineItemType.
     *
     * Strategy:
     * 1. Load order line items (SKU source of truth)
     * 2. Load returns (quantity-only)
     * 3. Reconcile returned quantities against ordered SKUs
     *
     * Guarantees:
     * - No SKU guessing
     * - No cross-order leakage
     * - Returned quantity ≤ ordered quantity
     */

    const orderQuery = `
    query OrderLineItems($orderId: ID!) {
    order(id: $orderId) {
        lineItems(first: 250) {
        nodes {
            sku
            quantity
        }
        }
        returns(first: 10) {
        nodes {
            returnLineItems(first: 50) {
            nodes {
                quantity
            }
            }
        }
        }
    }
    }
    `;

    const res = await axios.post(
    `https://${shopDomain}/admin/api/2024-01/graphql.json`,
    {
        query: orderQuery,
        variables: { orderId: ret.canonical_order_id },
    },
    {
        headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        },
        timeout: 5000,
    }
    );

    const order = res.data?.data?.order;
    if (!order) throw new Error('Order not found');

    const lineItems = order.lineItems?.nodes ?? [];
    const returns = order.returns?.nodes ?? [];

    /**
     * Deterministic reconciliation:
     * - Total returned quantity across all returns
     * - Apply sequentially to order line items
     */

    const totalReturnedQty = returns
    .flatMap((r: any) => r.returnLineItems?.nodes ?? [])
    .reduce((sum: number, r: any) => sum + Number(r.quantity || 0), 0);

    console.log('[returns-enrichment][debug] totalReturnedQty:', totalReturnedQty);

    let remaining = totalReturnedQty;

    for (const li of lineItems) {
    if (!li.sku || remaining <= 0) continue;

    const orderedQty = Number(li.quantity);
    const returnedQty = Math.min(orderedQty, remaining);
    if (returnedQty <= 0) continue;

    await trx('order_revenue_units')
        .where({
        shop_id: ret.shop_id,
        canonical_order_id: ret.canonical_order_id,
        sku: li.sku,
        })
        .increment('returned_quantity', returnedQty)
        .update({
        has_return_block: true,
        return_block_reason: 'customer_returned',
        return_evaluated_at: trx.fn.now(),
        });

    remaining -= returnedQty;
    }

    await trx('canonical_returns')
    .where({ canonical_return_id })
    .update({
        enrichment_status: 'enriched',
    });

      getQueueChannel('returns.enrichment.v1').ack(msg);
    } catch (err: any) {
      const attempt = ret.enrichment_attempts + 1;
      const backoff = computeBackoff(attempt);

      await trx('canonical_returns')
        .where({ canonical_return_id })
        .update({
          enrichment_status: backoff ? 'retrying' : 'failed',
          enrichment_attempts: attempt,
          next_enrichment_at: backoff
            ? trx.raw(`NOW() + INTERVAL '${backoff}'`)
            : null,
          last_enrichment_error: String(err?.message ?? err),
        });

      getQueueChannel('returns.enrichment.v1').ack(msg);
    }
  });
}

export function startReturnsEnrichmentWorker() {
  console.warn(
    '[DEPRECATED] Returns enrichment worker disabled — refunds pipeline active',
  );
}
