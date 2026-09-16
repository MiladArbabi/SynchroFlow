// apps/backend/src/services/shopify/shopifyCommercialResolver.service.ts
//
// BILL-ENTITLEMENT-01 / P0-B3 — canonical Shopify Managed Pricing resolver.
// ============================================================================
// THE PLAN HANDLE, NOT THE DISPLAY NAME, DECIDES THE TIER.
//
// Before this module, tier was keyed on `AppSubscription.name` — the
// merchant-facing invoice string (PLAN_NAME_TO_TIER). That made a Partner
// Dashboard rename a silent commercial outage for every merchant on the plan,
// and let any plan named "Growth" grant Growth at any price.
//
// The authoritative path is:
//
//     AppSubscription
//       -> lineItems[]
//       -> plan.pricingDetails            (AppRecurringPricing)
//       -> planHandle                     -> canonical tier
//
// planHandle is available from Admin API 2025-04 onward. Production runtime is
// 2025-07 and the released webhook API config is 2026-04 — both sufficient.
//
// AppSubscription.name is now carried purely as display/diagnostic information.
//
// PRESERVED SEMANTICS (SHB-08 / SHB-13, unchanged by this slice)
//   - ACTIVE                          -> entitled, paid tier
//   - CANCELLED / FROZEN in-period    -> entitled, paid tier retained (grace)
//   - CANCELLED / FROZEN lapsed       -> not entitled, starter
//   - PENDING / DECLINED / EXPIRED    -> not entitled, starter
//   - Shopify status vocabulary is mapped onto the shop_subscriptions
//     status check constraint exactly as before.

import type { Tier } from '@lasyncro/backend-core/config/tiers.js';

/**
 * Canonical Managed Pricing plan handles.
 *
 * Handles are the immutable identifiers configured in the Partner Dashboard;
 * unlike the display name they are not editable copy.
 */
const PLAN_HANDLE_TO_TIER: Record<string, Tier> = {
  starter: 'starter',
  core: 'core',
  growth: 'growth',
  scale: 'scale',
};

// Statuses representing a merchant with paid access currently live.
// PENDING is intentionally excluded — approval not yet completed.
const ACTIVE_STATUSES = new Set(['ACTIVE']);

// SHB-08: only statuses representing a subscription that WAS genuinely active
// and paid for get grace — CANCELLED (explicit cancel or uninstall) and FROZEN
// (payment failure). DECLINED/EXPIRED never completed approval, so no grace.
const GRACE_PERIOD_STATUSES = new Set(['CANCELLED', 'FROZEN']);

// shop_subscriptions.status has a DB check constraint
// (shop_subscriptions_status_valid) written for Stripe's lowercase vocabulary.
// Mapping is unchanged from the previous implementation.
const SHOPIFY_STATUS_TO_DB_STATUS: Record<string, string> = {
  ACTIVE: 'active',
  PENDING: 'unpaid',
  FROZEN: 'past_due',
  DECLINED: 'canceled',
  EXPIRED: 'canceled',
  CANCELLED: 'canceled',
};

export function mapShopifyStatusToDbStatus(shopifyStatus: string): string {
  return SHOPIFY_STATUS_TO_DB_STATUS[shopifyStatus] ?? 'canceled';
}

export interface ShopifyRecurringPrice {
  amount: string | null;
  currencyCode: string | null;
}

export interface ShopifyCommercialState {
  tier: Tier;
  /** Mapped DB status, not the raw Shopify enum. */
  status: string;
  isEntitled: boolean;
  currentPeriodEnd: Date | null;
  /** Authoritative provider fact. */
  planHandle: string;
  /** Diagnostic/display only — never used to decide tier. */
  displayName: string | null;
  /**
   * Provider recurring pricing facts, passed through verbatim for commercial
   * cross-check and provenance. No expected amounts are asserted here: no
   * canonical source declares per-plan Shopify amounts, and inventing one would
   * freeze a number nothing owns.
   */
  price: ShopifyRecurringPrice | null;
  interval: string | null;
  shopifySubscriptionId: string | null;
}

/** Resolves a Managed Pricing plan handle to a canonical tier. Throws if unmapped. */
export function resolveShopifyPlanHandle(planHandle: string): Tier {
  const normalized = String(planHandle ?? '').trim().toLowerCase();
  const tier = PLAN_HANDLE_TO_TIER[normalized];
  if (!tier) {
    throw new Error(`[shopify-commercial] unrecognized Managed Pricing plan handle: "${planHandle}"`);
  }
  return tier;
}

/** Finds the AppRecurringPricing details that carry the plan handle. */
function findRecurringPricing(appSubscription: any): any | null {
  const lineItems: any[] = appSubscription?.lineItems ?? [];
  for (const lineItem of lineItems) {
    const details = lineItem?.plan?.pricingDetails;
    if (details && typeof details.planHandle === 'string' && details.planHandle.length > 0) {
      return details;
    }
  }
  return null;
}

/**
 * Resolves a live AppSubscription to canonical commercial state.
 *
 * Throws when the plan handle is missing or unmapped — there is deliberately no
 * fallback to `name`. An unresolvable plan must not silently produce a tier.
 */
export function resolveShopifySubscriptionCommercial(appSubscription: any): ShopifyCommercialState {
  const pricingDetails = findRecurringPricing(appSubscription);

  if (!pricingDetails) {
    throw new Error(
      `[shopify-commercial] no AppRecurringPricing planHandle on subscription ` +
        `${appSubscription?.id ?? '<unknown>'} — refusing to fall back to the display name`
    );
  }

  const planHandle = pricingDetails.planHandle as string;
  const paidTier = resolveShopifyPlanHandle(planHandle);

  const rawStatus = String(appSubscription?.status ?? '');
  const currentPeriodEnd = appSubscription?.currentPeriodEnd
    ? new Date(appSubscription.currentPeriodEnd)
    : null;

  const inGracePeriod =
    GRACE_PERIOD_STATUSES.has(rawStatus) &&
    currentPeriodEnd !== null &&
    currentPeriodEnd.getTime() > Date.now();

  const isEntitled = ACTIVE_STATUSES.has(rawStatus) || inGracePeriod;

  const rawPrice = pricingDetails?.price;

  return {
    // SHB-13: force starter once active and grace have both ended.
    tier: isEntitled ? paidTier : ('starter' as Tier),
    status: mapShopifyStatusToDbStatus(rawStatus),
    isEntitled,
    currentPeriodEnd,
    planHandle,
    displayName: appSubscription?.name ?? null,
    price: rawPrice
      ? {
          amount: rawPrice.amount ?? null,
          currencyCode: rawPrice.currencyCode ?? null,
        }
      : null,
    interval: pricingDetails?.interval ?? null,
    shopifySubscriptionId: appSubscription?.id ?? null,
  };
}
