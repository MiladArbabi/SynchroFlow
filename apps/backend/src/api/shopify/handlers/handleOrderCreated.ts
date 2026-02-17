// apps/backend/src/api/shopify/handlers/handleOrderCreated.ts

import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';

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

  console.log('[ORDER CREATE HANDLER] ENTERED');

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

  // Sovereign ingestion will be handled by new ingestion layer.
  // Webhook handler now stops after resolving shop context.

}
