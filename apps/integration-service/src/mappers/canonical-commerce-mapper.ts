//apps/integration-service/src/mappers/canonical-commerce-mapper.ts
import {
  CanonicalOrder,
  CanonicalOrderLineItem,
  CanonicalProduct
} from '@synchroflow/shared/contracts/canonical-commerce';

type HashCustomerIdFn = (shopId: number, rawCustomerId: string) => string;

interface OrderMapperDeps {
  hashCustomerId: HashCustomerIdFn;
}

/**
 * Shopify → CanonicalOrder
 *
 * FT0 notes:
 * - Treat Shopify numeric IDs as canonical string IDs.
 * - Keep only PCD-safe hashed customer reference.
 * - Be defensive around nulls / missing fields.
 */
export function mapShopifyOrderToCanonical(
  rawOrder: any,
  deps: OrderMapperDeps
): CanonicalOrder {
  const shopId: number =
    typeof rawOrder.shop_id === 'number'
      ? rawOrder.shop_id
      : typeof rawOrder.shopId === 'number'
        ? rawOrder.shopId
        : 0;

  const id = String(rawOrder.id);

  const totalPrice = safeNumber(rawOrder.total_price);
  const subtotalPrice = safeNumber(rawOrder.subtotal_price);
  const totalTax = safeNumber(rawOrder.total_tax);

  const shippingLines =
    Array.isArray(rawOrder.shipping_lines) && rawOrder.shipping_lines.length > 0
      ? rawOrder.shipping_lines.map((line: any) => ({
          title: line.title ?? '',
          code: line.code ?? null,
          price: safeNumber(line.price)
        }))
      : [];

  const lineItems: CanonicalOrderLineItem[] = Array.isArray(rawOrder.line_items)
    ? rawOrder.line_items.map((item: any, index: number) => {
        const quantity = safeInt(item.quantity);
        const unitPrice = safeNumber(item.price);
        const totalPriceForLine = unitPrice * quantity;

        return {
          lineItemId: item.id != null ? String(item.id) : `${id}:${index}`,
          orderId: id,
          productId:
            item.product_id != null ? String(item.product_id) : null,
          variantId:
            item.variant_id != null ? String(item.variant_id) : null,
          title: item.name ?? item.title ?? '',
          sku: item.sku ?? null,
          quantity,
          unitPrice,
          totalPrice: totalPriceForLine,
          estimatedUnitCost: null,
          platform: 'shopify',
          platformLineItemId: item.id != null ? String(item.id) : undefined
        };
      })
    : [];

  let customer: CanonicalOrder['customer'] | undefined;

  if (rawOrder.customer && rawOrder.customer.id != null && shopId) {
    const hashedId = deps.hashCustomerId(shopId, String(rawOrder.customer.id));
    customer = {
      hashedId,
      customerType: 'registered'
    };
  }

  const createdAt: string =
    rawOrder.created_at ??
    rawOrder.createdAt ??
    new Date().toISOString();
  const updatedAt: string =
    rawOrder.updated_at ??
    rawOrder.updatedAt ??
    createdAt;

  const processedAtRaw =
    rawOrder.processed_at ?? rawOrder.processedAt ?? null;

  const canonical: CanonicalOrder = {
    id,
    shopId,
    createdAt,
    updatedAt,
    ...(processedAtRaw ? { processedAt: processedAtRaw } : {}),
    currency: rawOrder.currency ?? 'USD',
    totalPrice,
    subtotalPrice,
    totalTax,
    shippingLines,
    lineItems,
    ...(customer ? { customer } : {}),
    source: rawOrder.source_name ?? rawOrder.source ?? null,
    referrerMedium: rawOrder.referrer ?? null,
    platform: 'shopify',
    platformOrderId: id
  };

  return canonical;
}

/**
 * Shopify → CanonicalProduct
 *
 * FT0 notes:
 * - Use first variant as the default price / inventory source.
 * - Hard-fallback currency to 'USD' if none provided.
 */
export function mapShopifyProductToCanonical(
  shopId: number,
  rawProduct: any
): CanonicalProduct {
  const id = String(rawProduct.id);

  const variants: any[] = Array.isArray(rawProduct.variants)
    ? rawProduct.variants
    : [];

  const primaryVariant = variants[0] ?? {};

  const price = variants.length > 0 ? safeNumber(primaryVariant.price) : null;

  const inventoryQuantity =
    variants.length > 0 && primaryVariant.inventory_quantity != null
      ? safeInt(primaryVariant.inventory_quantity)
      : null;

  const inventoryPolicyRaw =
    variants.length > 0 ? primaryVariant.inventory_policy : null;

  const inventoryPolicy: CanonicalProduct['inventoryPolicy'] =
    inventoryPolicyRaw === 'continue' ||
    inventoryPolicyRaw === 'deny'
      ? inventoryPolicyRaw
      : 'unknown';

  const status: CanonicalProduct['status'] =
    rawProduct.status === 'active' ||
    rawProduct.status === 'draft' ||
    rawProduct.status === 'archived'
      ? rawProduct.status
      : 'unknown';

  const createdAt: string =
    rawProduct.created_at ??
    rawProduct.createdAt ??
    new Date().toISOString();
  const updatedAt: string =
    rawProduct.updated_at ??
    rawProduct.updatedAt ??
    createdAt;

  const canonical: CanonicalProduct = {
    id,
    shopId,
    title: rawProduct.title ?? '',
    sku: primaryVariant.sku ?? null,
    handle: rawProduct.handle ?? null,
    status,
    currency: primaryVariant.currency ?? 'USD',
    price,
    inventoryQuantity,
    inventoryPolicy,
    createdAt,
    updatedAt,
    platform: 'shopify',
    platformProductId: id,
    platformVariantCount: variants.length || undefined
  };

  return canonical;
}

// ---- helpers ----

function safeNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function safeInt(value: unknown): number {
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}