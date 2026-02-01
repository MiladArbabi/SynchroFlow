// apps/backend/src/services/order-nexus-canonical-ingestion.service.ts
import db from 'api-src/db';
import { getQueueChannel } from 'api-src/queue';
import { appendEvent, recordShopSession } from 'modules-specter/store/session-store';

interface CanonicalOrderRow {
  id: string;
  shop_id: number;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  currency: string;
  total_price: number;
  subtotal_price: number;
  total_tax: number;
  source: string | null;
  referrer_medium: string | null;
  platform: string;
  platform_order_id: string;
}

interface CanonicalLineItemRow {
  line_item_id: string;
  order_id: string;
  shop_id: number;
  product_id: string | null;
  variant_id: string | null;
  title: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  platform: string;
  platform_line_item_id: string;
}

interface NormalizedOrderLineItem {
  productId: string | null;
  variantId?: string;
  quantity: number;
  price: number;
}

interface NormalizedOrder {
  id: string;
  shopId: number;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  currency: string;
  totalPrice: number;
  subtotalPrice: number;
  totalTax: number;
  shippingLines: Array<{
    title: string;
    code: string | null;
    price: number;
  }>;
  lineItems: NormalizedOrderLineItem[];
}

interface OrderQueueMessage {
  shopId: number;
  orderId: string;
  topic: string;
  order: NormalizedOrder;
}

/**
 * IMPORTANT:
 * ----------
 * This service MUST NOT write to order_fulfillment_status.
 *
 * Fulfillment execution state is authoritative upstream data
 * produced by:
 * - fulfillment webhooks
 * - fulfillment reconciliation worker
 *
 * Order Nexus ingestion is a downstream consumer only.
 */


export class OrderNexusCanonicalIngestionService {
  private readonly channel: any;
  private readonly queueName = 'order_nexus_ingestion';

  constructor() {
    this.channel = getQueueChannel(this.queueName);
  }

   private buildCanonicalVariantCode(
    shopId: number,
    platformVariantId: string
  ): string {
    return `cvc:v1:${shopId}:${platformVariantId}`;
  }

  async enqueueOrderForOrderNexus(
    shopId: number,
    orderId: string
  ): Promise<void> {

    // 1) Load canonical order – use .from() so the test sees it
    const orderRow = await db<CanonicalOrderRow>('canonical_orders')
      .where('shop_id', shopId)
      .andWhere('canonical_order_id', orderId)
      .first();

    if (!orderRow) {
      // FT0: silently no-op if there's no canonical row
      return;
    }

    // 2) Load canonical line items – again via .from()
    const lineItemRows = await db()
      .from<CanonicalLineItemRow>('canonical_order_line_items')
      .where({ shop_id: shopId, order_id: orderId });

    // FT2 HARD GUARD — SKU / Variant identity must be explicit
    if (
      lineItemRows.some(
        (li) => !li.variant_id && !li.sku
      )
    ) {
      // Epistemic failure: SKU truth unavailable
      // Fail closed — do not enqueue
      return;
    }

    // 3) Map to the minimal NormalizedOrder shape OrderNexus expects
    const normalizedOrder: NormalizedOrder = {
      id: orderRow.id,
      shopId: orderRow.shop_id,
      createdAt: orderRow.created_at,
      updatedAt: orderRow.updated_at,
      ...(orderRow.processed_at
        ? { processedAt: orderRow.processed_at }
        : {}),
      currency: orderRow.currency,
      totalPrice: Number(orderRow.total_price),
      subtotalPrice: Number(orderRow.subtotal_price),
      totalTax: Number(orderRow.total_tax ?? 0),
      shippingLines: [], // FT0: shippingLines omitted
      lineItems: lineItemRows.map((li) => ({
        productId: li.product_id ? String(li.product_id) : null,
        variantId: li.variant_id
          ? this.buildCanonicalVariantCode(
              orderRow.shop_id,
              String(li.variant_id)
            )
          : undefined,
        quantity: li.quantity,
        price: li.unit_price ?? null,
      })),
    };

      const msg: OrderQueueMessage = {
      shopId: orderRow.shop_id,
      orderId: orderRow.id,
      topic: 'orders/create',
      order: normalizedOrder,
    };

    // Record canonical ingestion event in Specter (best-effort)
    // Enqueue to OrderNexus immediately (critical path)
    this.channel.sendToQueue(
      this.queueName,
      Buffer.from(JSON.stringify(msg))
    );

  
  // FT0: best-effort, non-blocking specter event — record that a canonical order was enqueued/ingested.
    // Keep this non-fatal: failures to write Specter events should not break or delay ingestion flow.
    (async () => {
      try {
        await appendEvent(orderRow.shop_id, {
          type: 'canonical.ingested',
          canonicalOrderId: orderRow.id,
          timestamp: Date.now(),
          payload: { topic: msg.topic }
        });

        // Also update a lightweight shop session record so Specter has lastIngestion metadata.
        // Use recordShopSession as a best-effort shallow session write (non-blocking).
        try {
          await recordShopSession(orderRow.shop_id, {
            // minimal session shape — recordShopSession will fill sessionId/shopId if missing
            createdAt: new Date().toISOString(),
            exitIntent: false,
            lastIngestion: Date.now()
          } as any);
        } catch (innerErr: any) {
          // non-fatal — log and continue
          // eslint-disable-next-line no-console
          console.warn('[order-nexus-canonical-ingestion] specter recordShopSession(lastIngestion) failed:', innerErr && innerErr.message ? innerErr.message : innerErr);
        }

      } catch (e: any) {
        // Log and move on — do not throw
        // eslint-disable-next-line no-console
        console.warn('[order-nexus-canonical-ingestion] specter appendEvent failed:', e && e.message ? e.message : e);
      }
    })();
  }
}

export default OrderNexusCanonicalIngestionService;