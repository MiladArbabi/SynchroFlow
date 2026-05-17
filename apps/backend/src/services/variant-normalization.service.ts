// apps/backend/src/services/variant-normalization.service.ts
export interface CanonicalVariantInput {
  shop_id: number;
  canonical_variant_id: string;
  lasyncro_product_id: string;
  sku: string | null;
  title: string | null;
  // Sourced from variant.image?.src — nullable, falls back to product image in UI
  image_url: string | null;
}

export class VariantNormalizationService {
  normalizeShopifyVariants(
    rawProduct: any,
    shopId: number
  ): CanonicalVariantInput[] {
    /**
     * rawProduct.id is already a Shopify GID.
     * Never re-wrap canonical identifiers.
     */
    const productId = String(rawProduct.id);
    const variants = Array.isArray(rawProduct?.variants?.edges)
      ? rawProduct.variants.edges.map((e: any) => e.node)
      : [];
    return variants
      .filter((v: any) => v && v.id)
      .map((v: any) => ({
        shop_id: shopId,
        canonical_variant_id: String(v.id),
        lasyncro_product_id: productId,
        sku: v.sku ?? null,
        title: v.title ?? null,
        // variant.image?.src is the Shopify variant-level image URL.
        // Nullable — not all variants have a dedicated image.
        image_url: v.image?.src ?? null,
      }));
  }
}