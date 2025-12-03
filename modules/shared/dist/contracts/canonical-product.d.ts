export type CanonicalProductStatus = 'active' | 'inactive' | 'archived';
export interface CanonicalProductInput {
    shopId: number;
    platform: 'shopify';
    platformProductId: string;
    platformVariantId?: string | null;
    sku?: string | null;
    title: string;
    status?: CanonicalProductStatus;
    createdAt: string;
    updatedAt: string;
}
export interface CanonicalProduct extends CanonicalProductInput {
    canonicalProductId: number;
}
