// apps/backend/src/api/shopify/handlers/handleOrderCreated.ts

import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import db from 'api-src/db';
import { CanonicalCommerceIngestionService }
  from 'api-src/services/canonical-commerce-ingestion.service';
import type { FT0CanonicalOrder }
  from '@lasyncro/shared/contracts/ft0-canonical-order';

type ShopifyOrderCreatePayload = {
  id: number | string;
  admin_graphql_api_id?: string;
  currency: string;
  total_price: string | number;
  subtotal_price?: string | number;
  total_tax?: string | number;
  created_at: string;
  updated_at: string;
  processed_at?: string;
  source_name?: string;
  line_items?: Array<{
    id: number | string;
    product_id?: number | string;
    variant_id?: number | string;
    title: string;
    sku?: string;
    quantity: number;
    price: string | number;
  }>;
};

export async function handleOrderCreated(
  envelope: WebhookEnvelope
): Promise<void> {

  const raw = envelope.rawPayload as Partial<ShopifyOrderCreatePayload>;
  const shopDomain = envelope.shopDomain;

  if (!raw?.id || !raw.created_at || !raw.updated_at || !shopDomain) {
    return;
  }

  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) return;

  const shopId = installation.shop_id;

  const canonicalOrderId =
    raw.admin_graphql_api_id ??
    `gid://shopify/Order/${raw.id}`;

  const canonicalOrder: FT0CanonicalOrder = {
    id: canonicalOrderId,
    shopId,
    platform: 'shopify',
    platformOrderId: String(raw.id),

    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    processedAt: raw.processed_at ?? raw.created_at ?? null,

    currency: raw.currency ?? null,

    totalPrice: raw.total_price != null ? Number(raw.total_price) : null,
    subtotalPrice: raw.subtotal_price != null ? Number(raw.subtotal_price) : null,
    totalTax: raw.total_tax != null ? Number(raw.total_tax) : null,

    // 🔥 REQUIRED FIELD
    shippingLines: [],

    lineItems: (raw.line_items ?? []).map(li => ({
        lineItemId: String(li.id),
        orderId: canonicalOrderId,

        productId: li.product_id ? String(li.product_id) : null,
        variantId: li.variant_id ? String(li.variant_id) : null,

        title: li.title,
        sku: li.sku ?? null,

        quantity: Number(li.quantity),

        unitPrice: li.price != null ? Number(li.price) : null,
        totalPrice:
        li.price != null
            ? Number(li.price) * Number(li.quantity)
            : null,

        estimatedUnitCost: null,

        platform: 'shopify',
        platformLineItemId: String(li.id),
    })),

    customer: undefined,

    source: raw.source_name ?? null,
    referrerMedium: null,
};


  const canonicalService = new CanonicalCommerceIngestionService();
  await canonicalService.insertCanonicalOrder(canonicalOrder);
}
