// packages/shared/contracts/canonical-product.ts

export type CanonicalProductStatus = 'active' | 'inactive' | 'archived';

export interface CanonicalProductInput {
  shopId: number;
  platform: 'shopify'; // FT0 scope – extend later if needed
  platformProductId: string;      // Shopify product_id as string
  platformVariantId?: string | null; // optional – variant-level details if needed
  sku?: string | null;
  title: string;
  status?: CanonicalProductStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface CanonicalProduct extends CanonicalProductInput {
  // Canonical numeric ID used across OrderNexus, SKU-OS, InsightCore
  canonicalProductId: number;
}
