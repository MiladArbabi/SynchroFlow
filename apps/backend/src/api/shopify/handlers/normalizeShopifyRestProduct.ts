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

type RestVariant = {
  id: number | string;
  title: string;
  sku?: string | null;
  barcode?: string | null;
  inventory_item_id?: number | string | null;
};

type RestProduct = {
  id: number | string;
  title: string;
  status?: string | null;
  product_type?: string | null;
  image?: { src?: string | null } | null;
  variants?: RestVariant[];
};

function toGid(type: string, id: number | string): string {
  return `gid://shopify/${type}/${id}`;
}

export function normalizeRestProductToEdge(product: RestProduct) {
  return {
    node: {
      id: toGid('Product', product.id),
      title: product.title,
      status: product.status ?? 'active',
      productType: product.product_type ?? null,
      featuredImage: product.image?.src ? { url: product.image.src } : null,
      variants: {
        edges: (product.variants ?? []).map((v) => ({
          node: {
            id: toGid('ProductVariant', v.id),
            title: v.title,
            sku: v.sku ?? null,
            barcode: v.barcode ?? null,
            image: null,
            inventoryItem: {
              id: v.inventory_item_id ? toGid('InventoryItem', v.inventory_item_id) : null,
              unitCost: null,
            },
          },
        })),
      },
    },
  };
}