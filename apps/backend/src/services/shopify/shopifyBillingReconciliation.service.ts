import { Tier } from '@lasyncro/backend-core/config/tiers.js';
import { resolveShopifyAccessToken } from '../../api/shopify/shopify.billing.controller.js';
import {
  resolveShopifySubscriptionCommercial,
  type ShopifyRecurringPrice,
} from './shopifyCommercialResolver.service.js';

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION!;

// BILL-ENTITLEMENT-01 / P0-B3: the legacy name-keyed tier map has been removed.
// Tier used to be keyed on AppSubscription.name — the merchant-facing invoice
// string — so a Partner Dashboard rename was a silent commercial outage and any
// plan named "Growth" granted Growth at any price. Tier now comes from the
// immutable AppRecurringPricing.planHandle via shopifyCommercialResolver.
// Status/grace mapping moved there too, unchanged in behaviour.

// Selection only (not entitlement): Shopify allows one active app subscription
// per shop, but we defensively prefer an ACTIVE entry rather than assuming
// array length === 1. Entitlement itself is decided by the canonical resolver.
const ACTIVE_STATUSES = new Set(['ACTIVE']);

export interface ShopifyBillingState {
  tier: Tier;
  status: string; // mapped DB status
  isEntitled: boolean; // true only when active or inside a paid grace period
  currentPeriodEnd: Date | null;
  shopifySubscriptionId: string | null;
  shopifySubscriptionName: string | null;
  /** Authoritative provider fact that decided the tier. */
  planHandle: string | null;
  /** Provider recurring pricing facts, for commercial cross-check/provenance. */
  price: ShopifyRecurringPrice | null;
  interval: string | null;
}

/**
 * Fetch and normalize a shop's live Shopify Managed Pricing state.
 * Falls back to 'starter' / not-entitled if no active subscription exists
 * (e.g. merchant hasn't approved a plan yet, or is on the free plan).
 */
export async function fetchShopifyBillingState(shopId: number): Promise<ShopifyBillingState> {
  const { accessToken, shopDomain } = await resolveShopifyAccessToken(shopId);

  const response = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // P0-B3: lineItems -> plan -> pricingDetails is the authoritative path.
      // planHandle is available from Admin API 2025-04 onward (production runs
      // 2025-07, released webhook config 2026-04). `name` is still requested,
      // but only for display/diagnostics.
      query: `{
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            currentPeriodEnd
            lineItems {
              id
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    planHandle
                    interval
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }`,
    }),
  });

  if (!response.ok) {
    throw new Error(`[shopify_billing_reconciliation] GraphQL request failed: ${response.status}`);
  }

  const json = await response.json();
  const subscriptions = json?.data?.currentAppInstallation?.activeSubscriptions ?? [];

  if (subscriptions.length === 0) {
    console.warn('[shopify_billing_reconciliation] no active subscriptions found', { shopId });
    return {
      tier: 'starter',
      status: 'canceled',
      isEntitled: false,
      currentPeriodEnd: null,
      shopifySubscriptionId: null,
      shopifySubscriptionName: null,
      planHandle: null,
      price: null,
      interval: null,
    };
  }

  const sub =
    subscriptions.find((s: any) => ACTIVE_STATUSES.has(s.status)) ?? subscriptions[0];

  // Authoritative resolution is delegated to the canonical resolver, which
  // keys on planHandle and preserves the SHB-08 grace and SHB-13 starter
  // semantics exactly. An unmapped or missing handle throws there rather than
  // falling back to the display name.
  const commercial = resolveShopifySubscriptionCommercial(sub);

  return {
    tier: commercial.tier,
    status: commercial.status,
    isEntitled: commercial.isEntitled,
    currentPeriodEnd: commercial.currentPeriodEnd,
    shopifySubscriptionId: commercial.shopifySubscriptionId,
    shopifySubscriptionName: commercial.displayName,
    planHandle: commercial.planHandle,
    price: commercial.price,
    interval: commercial.interval,
  };
}
