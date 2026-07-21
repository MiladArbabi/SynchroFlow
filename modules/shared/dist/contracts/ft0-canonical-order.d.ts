import type { CanonicalPlatform } from './canonical-commerce.js';
export interface FT0CanonicalOrder {
    id: string;
    shopId: number;
    /**
     * Temporal anchors
     * ----------------
     * These reflect platform-observed timestamps.
     * They may be null if the platform does not expose them.
     */
    createdAt: string | null;
    updatedAt: string | null;
    processedAt?: string | null;
    /**
     * Currency
     * --------
     * Null only if platform does not expose a currency code
     * (rare but possible in edge ingestion states).
     */
    currency: string | null;
    /**
     * Monetary observables
     * --------------------
     * Monetary fields MUST NOT be inferred.
     * Null means "not observed", never zero.
     */
    totalPrice: number | null;
    subtotalPrice: number | null;
    totalTax: number | null;
    shippingLines: any[];
    /**
     * Shipping address (WM-34)
     * ------------------------
     * Full recipient address for invoice PDF generation.
     * Null for digital/gift card orders.
     */
    shippingAddress?: {
        name?: string | null;
        address1?: string | null;
        address2?: string | null;
        city?: string | null;
        zip?: string | null;
        phone?: string | null;
        provinceCode?: string | null;
        countryCode?: string | null;
    } | null;
    lineItems: {
        lineItemId: string;
        orderId: string;
        productId: string | null;
        variantId?: string | null;
        title: string;
        sku: string | null;
        quantity: number;
        unitPrice: number | null;
        totalPrice: number | null;
        estimatedUnitCost: number | null;
        platform: CanonicalPlatform;
        platformLineItemId?: string;
    }[];
    customer?: {
        hashedId: string;
        customerType: 'registered' | 'guest';
    };
    source: string | null;
    referrerMedium: string | null;
    platform: CanonicalPlatform;
    platformOrderId: string;
}
//# sourceMappingURL=ft0-canonical-order.d.ts.map