// Declaration shim for `shared-src/*` used by backend compilation.
// Keep these declarations minimal — only what backend needs to compile.
declare module 'shared-src/contracts/canonical-commerce' {
  export type CanonicalPlatform = 'shopify' | string;

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
    lineItemId: string;
    orderId: string;
    productId: string | null;
    variantId?: string | null;
    title: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    estimatedUnitCost: number | null;
    platform: CanonicalPlatform;
    platformLineItemId?: string;
  }

  export interface CanonicalOrder {
    id: string;
    shopId: number;
    createdAt: string;
    updatedAt: string;
    processedAt?: string;
    currency: string;
    totalPrice: number;
    subtotalPrice: number;
    totalTax: number;
    shippingLines: CanonicalShippingLine[];
    lineItems: CanonicalOrderLineItem[];
    customer?: CanonicalOrderCustomer;
    source: string | null;
    referrerMedium: string | null;
    platform: CanonicalPlatform;
    platformOrderId: string;
  }
}

// Provide a wildcard module to avoid other unresolved imports under shared-src/*
declare module 'shared-src/*' {
  // Any — tests use jest mappings to load real shared files at runtime.
  const v: any;
  export = v;
}