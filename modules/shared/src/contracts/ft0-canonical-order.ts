//modules/shared/src/contracts/ft0-canonical-order.ts
import type { CanonicalPlatform } from './canonical-commerce';

export interface FT0CanonicalOrder {
  id: string;
  shopId: number;

  createdAt: string;
  updatedAt: string;
  processedAt?: string;

  currency: string;

  totalPrice: number;
  subtotalPrice: number;
  totalTax: number;

  shippingLines: any[];

  lineItems: {
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