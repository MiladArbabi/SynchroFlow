/**
 * Canonical Commerce Contract – FT0 v1
 *
 * This is the cross-platform, PCD-safe canonical model for:
 * - Orders ingested via integration-service (Shopify, etc.)
 * - Canonical persistence in the backend (canonical_orders + canonical_order_line_items)
 * - Downstream ingestion into OrderNexus / SKU OS / other engines.
 *
 * ⚠️ LOCKED FOR FT0:
 * - Changing field names, types, or required/optional status is a BREAKING CHANGE.
 * - Any breaking change must go through a versioned contract (v2) + migration plan.
 */
export type CanonicalPlatform = 'shopify' | string;
export * from './canonical-product';
export interface CanonicalShippingLine {
    title: string;
    code: string | null;
    price: number;
}
export type CanonicalCustomerType = 'registered' | 'guest';
export interface CanonicalOrderCustomer {
    hashedId: string;
    customerType: CanonicalCustomerType;
}
export interface CanonicalOrderLineItem {
    /**
     * Canonical line item ID (stringified platform id or synthetic).
     * Must be stable per order.
     */
    lineItemId: string;
    /** Canonical order ID (matches CanonicalOrder.id). */
    orderId: string;
    /** Platform product identifier, stringified; null if not available. */
    productId: string | null;
    /** Platform variant identifier, stringified; may be null/undefined. */
    variantId?: string | null;
    title: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    /**
     * Optional estimated unit cost.
     * May be null in FT0; future phases can populate from cost models.
     */
    estimatedUnitCost: number | null;
    platform: CanonicalPlatform;
    platformLineItemId?: string;
}
export interface CanonicalOrder {
    canonical_order_id(canonical_order_id: any): unknown;
    total_price(total_price: any): unknown;
    customer_email(customer_email: any): unknown;
    tags(tags: any): boolean;
    first_item_sku(first_item_sku: any): unknown;
    second_item_price(second_item_price: any): unknown;
    optional_field(optional_field: any): unknown;
    zero_value(zero_value: any): unknown;
    false_value(false_value: any): unknown;
    empty_string(empty_string: any): unknown;
    items(items: any): boolean;
    first_item_categories(first_item_categories: any): boolean;
    line_items(line_items: any): boolean;
    final_price(final_price: any): unknown;
    mapped_field0(mapped_field0: any): unknown;
    mapped_field999(mapped_field999: any): unknown;
    is_active(is_active: any): unknown;
    order_notes(order_notes: any): unknown;
    billing_address: any;
    subtotal_price(subtotal_price: any): unknown;
    total_tax(total_tax: any): unknown;
    shipping_price(shipping_price: any): unknown;
    payment_method(payment_method: any): unknown;
    payment_status(payment_status: any): unknown;
    deeply_nested_value(deeply_nested_value: any): unknown;
    /** Canonical order ID – for Shopify this is the numeric ID as string. */
    id: string;
    /** Internal shop PK (matches shops.id in the backend). */
    shopId: number;
    /** ISO timestamps – created/updated at the source platform. */
    createdAt: string;
    updatedAt: string;
    processedAt?: string;
    /** 3-letter currency code. */
    currency: string;
    totalPrice: number;
    subtotalPrice: number;
    totalTax: number;
    shippingLines: CanonicalShippingLine[];
    lineItems: CanonicalOrderLineItem[];
    /** Optional PCD-safe customer reference (hashed ID). */
    customer?: CanonicalOrderCustomer;
    /** Source / channel information from the platform (e.g. Shopify source_name). */
    source: string | null;
    referrerMedium: string | null;
    platform: CanonicalPlatform;
    /**
     * Platform-native order ID, stringified.
     * For FT0 this is the same as `id`, but kept separate for future flexibility.
     */
    platformOrderId: string;
}
export type CanonicalProductStatus = 'active' | 'draft' | 'archived' | 'unknown';
export type CanonicalInventoryPolicy = 'continue' | 'deny' | 'unknown';
/**
 * Full canonical product shape used by downstream engines.
 * This is the long-term CNS representation, not necessarily 1:1 with FT0 DB schema.
 */
export interface CanonicalProduct {
    /** Canonical product ID – platform product id as string. */
    id: string;
    /** Internal shop PK (matches shops.id). */
    shopId: number;
    title: string;
    sku: string | null;
    handle: string | null;
    status: CanonicalProductStatus;
    /** 3-letter currency code for pricing. */
    currency: string;
    /**
     * Primary price for FT0:
     * - For Shopify: price of first variant, or null if none.
     */
    price: number | null;
    /**
     * Aggregated / primary inventory quantity.
     * May be null if not known.
     */
    inventoryQuantity: number | null;
    inventoryPolicy: CanonicalInventoryPolicy;
    /** ISO timestamps from the source platform. */
    createdAt: string;
    updatedAt: string;
    platform: CanonicalPlatform;
    platformProductId: string;
    /**
     * Number of platform variants, if known.
     * For Shopify: variants.length, or undefined when not provided.
     */
    platformVariantCount?: number;
}
/**
 * FT0 ingestion shape for canonical_products upsert.
 *
 * This is what the backend worker uses to upsert rows into the canonical_products
 * table. It is intentionally smaller than CanonicalProduct and includes the
 * platformVariantId used in the DB unique key.
 */
export interface CanonicalProductInput {
    shopId: number;
    platform: CanonicalPlatform;
    platformProductId: string;
    platformVariantId: string | null;
    sku: string | null;
    title: string;
    status: CanonicalProductStatus;
    createdAt: string;
    updatedAt: string;
}
