// apps/backend/src/services/product-normalization.service.ts

import {
  CanonicalProductInput,
  CanonicalProductStatus,
} from '@lasyncro/shared';

export class ProductNormalizationService {
  /**
   * Normalize a raw Shopify product payload into CanonicalProductInput.
   *
   * NOTE:
   * - canonical_product_id is assigned by DB insert
   * - shopId is injected externally (from linkage / config)
   */
  normalizeShopifyProduct(rawProduct: any, shopId: number): CanonicalProductInput {
    if (!rawProduct || typeof rawProduct !== 'object') {
      throw new Error('Invalid Shopify product payload');
    }

    const now = new Date().toISOString();

    return {
      shopId,
      platform: 'shopify',
      platformProductId: String(rawProduct.id),
      // Variant-level linkage is optional; FT0 focuses on product-level entity.
      // If you later decide to store variant-level canonical rows, you can
      // extend this service or introduce a separate variant normalizer.
      platformVariantId: null,
      sku: this.extractPrimarySku(rawProduct),
      title: rawProduct.title || 'Untitled product',
      status: this.mapShopifyStatus(rawProduct.status),
      createdAt: rawProduct.created_at || now,
      updatedAt: rawProduct.updated_at || now,
    };
  }

  private extractPrimarySku(rawProduct: any): string | null {
    const variants = Array.isArray(rawProduct.variants) ? rawProduct.variants : [];
    if (!variants.length) return null;

    // Simple rule: first non-empty SKU among variants
    const withSku = variants.find((v: any) => v && typeof v.sku === 'string' && v.sku.trim() !== '');
    return withSku ? withSku.sku : null;
  }

   private mapShopifyStatus(status: string | undefined): CanonicalProductStatus {
    const s = status ?? 'active';

    switch (s) {
      case 'active':
      case 'active_online':
        return 'active';
      case 'archived':
        return 'archived';
      case 'draft':
        return 'draft';
      default:
        return 'unknown';
    }
  }
}
