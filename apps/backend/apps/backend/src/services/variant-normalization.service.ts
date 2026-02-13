// apps/backend/src/services/variant-normalization.service.ts

export interface CanonicalVariantInput {
  shopId: number;
  canonicalVariantId: string;
  canonicalProductId: string;
  sku: string | null;
  title: string | null;
}

export class VariantNormalizationService {
  normalizeShopifyVariants(
    rawProduct: any,
    shopId: number
  ): CanonicalVariantInput[] {
    if (!rawProduct?.variants || !Array.isArray(rawProduct.variants)) {
      return [];
    }

    // IMPORTANT:
    // lasyncro_product_id MUST match the value used by order ingestion
    // Orders store Shopify GIDs (gid://shopify/Product/*)
    const canonicalProductId = `gid://shopify/Product/${rawProduct.id}`;

    return rawProduct.variants.map((variant: any) => ({
        shopId,
        canonicalVariantId: String(variant.id),
        canonicalProductId,
        sku: variant.sku ?? null,
        title: variant.title ?? null,
    }));
  }
}