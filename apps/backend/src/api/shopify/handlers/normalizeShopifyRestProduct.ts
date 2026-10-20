// apps/backend/src/api/shopify/handlers/normalizeShopifyRestProduct.ts
//
// REST → GraphQL Edge Normalizer
//
// Shopify REST webhooks send flat numeric IDs.
// syncProducts expects GraphQL edges format with GIDs.
// This adapter bridges the two without mutating syncProducts.
//
// NOTE: unitCost is unavailable in REST webhook payloads.
// Variants synced via webhook will have unitCost = 0 (existing fallback).
// Cost is only available via GraphQL API (full OAuth sync path).
//
// VALIDATION BOUNDARY (GH-1262 A2.3)
// ----------------------------------
// Malformed input throws before anything is persisted, so the webhook ledger
// records the event as failed and Shopify may retry — it is never
// acknowledged as processed:
// - product / variant / inventory-item ids must be canonical positive numeric
//   Shopify ids; a GID-form id is rejected here, never double-normalized;
// - a present status must be one of the Shopify 2026-04 product statuses
//   active, archived, draft, unlisted — anything else (including 'deleted')
//   is rejected, never coerced;
// - a present title must be a non-empty string (syncProducts additionally
//   requires one before creating a product that does not exist yet).
//
// FIELD PRESENCE (O1): an absent sku / barcode / inventory_item_id stays
// absent (undefined) on the edge, so syncProducts preserves the persisted
// value. An explicit null or '' is passed through as a deliberate clear.

type RestVariant = {
  id?: unknown;
  title?: string;
  sku?: string | null;
  barcode?: string | null;
  inventory_item_id?: unknown;
};

type RestProduct = {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  updated_at?: unknown;
  product_type?: string | null;
  image?: { src?: string | null } | null;
  variants?: unknown;
};

const REST_PRODUCT_STATUSES = new Set(['active', 'archived', 'draft', 'unlisted']);

/** Canonical Shopify REST id: a positive safe integer or its plain decimal string. */
function canonicalShopifyId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value === 'string') return /^[1-9][0-9]*$/.test(value) ? value : null;
  return null;
}

function toGid(type: string, id: string): string {
  return `gid://shopify/${type}/${id}`;
}

const hasField = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

export function normalizeRestProductToEdge(product: RestProduct) {
  if (!product || typeof product !== 'object') {
    throw new Error('SHOPIFY_REST_PRODUCT_PAYLOAD_INVALID');
  }
  const productId = canonicalShopifyId(product.id);
  if (!productId) {
    throw new Error('SHOPIFY_REST_PRODUCT_ID_INVALID');
  }
  if (product.title !== undefined && (typeof product.title !== 'string' || product.title.trim() === '')) {
    throw new Error(`SHOPIFY_REST_PRODUCT_TITLE_INVALID: product ${productId}`);
  }
  if (product.status != null
    && (typeof product.status !== 'string' || !REST_PRODUCT_STATUSES.has(product.status))) {
    throw new Error(`SHOPIFY_REST_PRODUCT_STATUS_INVALID: product ${productId}`);
  }
  if (product.variants !== undefined && !Array.isArray(product.variants)) {
    throw new Error(`SHOPIFY_REST_PRODUCT_VARIANTS_INVALID: product ${productId}`);
  }

  const edges = ((product.variants as unknown[] | undefined) ?? []).map((value) => {
    const v = value as RestVariant;
    const variantId = v && typeof v === 'object' ? canonicalShopifyId(v.id) : null;
    if (!variantId) {
      throw new Error(`SHOPIFY_REST_VARIANT_ID_INVALID: product ${productId}`);
    }

    let inventoryItemId: string | null | undefined;
    if (hasField(v, 'inventory_item_id') && v.inventory_item_id !== null) {
      const canonical = canonicalShopifyId(v.inventory_item_id);
      if (!canonical) {
        throw new Error(`SHOPIFY_REST_INVENTORY_ITEM_ID_INVALID: variant ${variantId}`);
      }
      inventoryItemId = toGid('InventoryItem', canonical);
    } else if (hasField(v, 'inventory_item_id')) {
      inventoryItemId = null;
    }

    return {
      node: {
        id: toGid('ProductVariant', variantId),
        title: v.title,
        sku: hasField(v, 'sku') ? v.sku ?? null : undefined,
        barcode: hasField(v, 'barcode') ? v.barcode ?? null : undefined,
        image: null,
        inventoryItem: {
          id: inventoryItemId,
          unitCost: null,
        },
      },
    };
  });

  return {
    node: {
      id: toGid('Product', productId),
      title: product.title,
      // Absent status stays absent: syncProducts treats it as unknown, never
      // reactivates an archived/draft product from it (GH-1262) and never
      // creates a new product without it (A2.3 O3).
      status: (product.status as string | null | undefined) ?? null,
      // Source freshness timestamp, passed through as received: syncProducts
      // validates it and fails closed on a malformed value (GH-1262 A2.2).
      updatedAt: product.updated_at ?? null,
      productType: product.product_type ?? null,
      featuredImage: product.image?.src ? { url: product.image.src } : null,
      variants: { edges },
    },
  };
}
