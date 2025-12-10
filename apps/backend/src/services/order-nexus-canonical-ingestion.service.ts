// apps/backend/src/services/order-nexus-canonical-ingestion.service.ts
import db from 'api-src/db';
import { getQueueChannel } from 'api-src/queue';
import { appendEvent } from 'modules-specter/store/session-store';

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

export class OrderNexusCanonicalIngestionService {
  private readonly channel: any;
  private readonly queueName = 'order_nexus_ingestion';

  constructor() {
    this.channel = getQueueChannel(this.queueName);
  }

  async enqueueOrderForOrderNexus(
    shopId: number,
    orderId: string
  ): Promise<void> {
    // 1) Load canonical order – use .from() so the test sees it
    const orderRow = await db()
      .from<CanonicalOrderRow>('canonical_orders')
      .where({ shop_id: shopId, id: orderId })
      .first();

    if (!orderRow) {
      // FT0: silently no-op if there's no canonical row
      return;
    }

    // 2) Load canonical line items – again via .from()
    const lineItemRows = await db()
      .from<CanonicalLineItemRow>('canonical_order_line_items')
      .where({ shop_id: shopId, order_id: orderId });

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
        variantId: li.variant_id ? String(li.variant_id) : undefined,
        quantity: li.quantity,
        price: li.unit_price,
      })),
    };

      const msg: OrderQueueMessage = {
      shopId: orderRow.shop_id,
      orderId: orderRow.id,
      topic: 'orders/create',
      order: normalizedOrder,
    };

    // Record canonical ingestion event in Specter (best-effort)
    try {
      await appendEvent(orderRow.shop_id, {
        type: 'canonical.ingested',
        canonicalOrderId: orderRow.id,
        timestamp: Date.now(),
        payload: { topic: msg.topic }
      });
    } catch (e: any) {
      // Do not block ingestion on Specter failures — log and continue
      // eslint-disable-next-line no-console
      console.warn('[order-nexus-canonical-ingestion] specter appendEvent failed:', e && e.message ? e.message : e);
    }

    this.channel.sendToQueue(
      this.queueName,
      Buffer.from(JSON.stringify(msg))
    );
  }
}

export default OrderNexusCanonicalIngestionService;