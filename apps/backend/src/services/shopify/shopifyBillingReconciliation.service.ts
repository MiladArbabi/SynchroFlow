
// apps/backend/src/services/shopify/shopifyBillingReconciliation.service.ts
//
// Shopify Managed Pricing Reconciliation (SHB-01)
// -------------------------------------------------
// Authoritative fetch of a shop's live Shopify billing state via the
// Admin GraphQL Active Subscription API. Reusable by:
//   - handleAppSubscriptionUpdate webhook handler (event-triggered)
//   - GET /api/v1/shopify-billing/subscription (on-demand, e.g. post-redirect)
//   - future install-time / cron reconciliation
//
// HARD RULES:
//   - Read-only against Shopify — never mutates shop_subscriptions itself.
//     Callers own the DB write, matching handleSubscriptionUpsert's pattern.
//   - AppSubscription has NO `handle` field (verified via introspection,
//     SHB-12) — tier mapping keys on `name`, the invoice-facing display
//     string. Comparison is normalized (trim + lowercase) to tolerate
//     incidental whitespace/casing drift without silently breaking sync.
//   - Multiple activeSubscriptions should not occur (Shopify allows one
//     active app subscription per shop) but we defensively take the
//     first ACTIVE one if present, else the first entry, rather than
//     assume array length === 1.

import { Tier } from '@lasyncro/backend-core/config/tiers.js';
import { resolveShopifyAccessToken } from '../../api/shopify/shopify.billing.controller.js';

const SHOPIFY_API_VERSION = '2026-07';

// SHB-12: keys are the exact "Plan name for merchant invoices" values
// as saved in the Partner Dashboard. Normalized lowercase at lookup time.
const PLAN_NAME_TO_TIER: Record<string, Tier> = {
  'early access': 'starter',
  'core': 'core',
  'growth': 'growth',
  'scale': 'scale',
};

// Statuses that represent a merchant with paid access currently live.
// PENDING is intentionally excluded — approval not yet completed.
const ACTIVE_STATUSES = new Set(['ACTIVE']);

// SHB-08: uninstall/cancellation must not cut access before the merchant's
// already-paid period ends — Shopify still owes them that time. Only
// statuses that represent a subscription that WAS genuinely active and
// paid for get this grace: CANCELLED (explicit cancel or uninstall, which
// auto-cancels the charge) and FROZEN (payment failure on an active sub —
// same semantics as Stripe past_due, conventionally given a grace/dunning
// window). DECLINED and EXPIRED mean the merchant never completed approval
// in the first place — no paid period was ever purchased, so no grace
// applies; downgrade is immediate. Confirmed with product owner.
const GRACE_PERIOD_STATUSES = new Set(['CANCELLED', 'FROZEN']);

export interface ShopifyBillingState {
  tier: Tier;
  status: string; // raw Shopify status, stored verbatim for audit/display
  isEntitled: boolean; // true only when status is a recognized active state
  currentPeriodEnd: Date | null;
  shopifySubscriptionId: string | null;
  shopifySubscriptionName: string | null;
}


// shop_subscriptions.status has a DB check constraint
// (shop_subscriptions_status_valid) written for Stripe's lowercase
// lifecycle vocabulary: trialing, active, past_due, canceled, unpaid.
// Shopify's AppSubscriptionStatus enum (ACTIVE, PENDING, DECLINED,
// EXPIRED, FROZEN, CANCELLED) has no exact equivalents — writing the
// raw Shopify value verbatim violates the constraint even for the
// success case (case mismatch alone: 'ACTIVE' !== 'active'). Mapped
// by closest semantic fit, confirmed with product owner:
//   ACTIVE    -> active     (live paid entitlement)
//   PENDING   -> unpaid     (no payment collected, awaiting decision)
//   FROZEN    -> past_due   (billing issue, Shopify-side hold)
//   DECLINED  -> canceled   (never activated)
//   EXPIRED   -> canceled
//   (no sub)  -> canceled   (no live paid subscription)
const SHOPIFY_STATUS_TO_DB_STATUS: Record<string, string> = {
  ACTIVE: 'active',
  PENDING: 'unpaid',
  FROZEN: 'past_due',
  DECLINED: 'canceled',
  EXPIRED: 'canceled',
  CANCELLED: 'canceled',
};

function mapToDbStatus(shopifyStatus: string): string {
  return SHOPIFY_STATUS_TO_DB_STATUS[shopifyStatus] ?? 'canceled';
}

export interface ShopifyBillingState {
  tier: Tier;
  status: string; // raw Shopify status, stored verbatim for audit/display
  isEntitled: boolean; // true only when status is a recognized active state
  shopifySubscriptionId: string | null;
  shopifySubscriptionName: string | null;
}

// Shopify Managed Pricing plan names may use hyphens where our map uses
// spaces (confirmed live: saved name is "Early-access", not "Early Access").
// Normalize hyphens/underscores to spaces before lowercasing so both forms
// match the same map key, rather than hardcoding one exact string.
function normalizePlanName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
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
      query: `{
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            currentPeriodEnd
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
    };
  }

  const sub =
    subscriptions.find((s: any) => ACTIVE_STATUSES.has(s.status)) ?? subscriptions[0];

  const normalizedName = normalizePlanName(sub.name ?? '');
  const tier = PLAN_NAME_TO_TIER[normalizedName];

  if (!tier) {
    console.error('[shopify_billing_reconciliation] unrecognized plan name', {
      shopId,
      rawName: sub.name,
      subscriptionId: sub.id,
    });
    throw new Error(`[shopify_billing_reconciliation] unrecognized plan name: "${sub.name}"`);
  }

  const currentPeriodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const inGracePeriod =
    GRACE_PERIOD_STATUSES.has(sub.status) &&
    currentPeriodEnd !== null &&
    currentPeriodEnd.getTime() > Date.now();

  // SHB-08: during grace, keep the merchant on their paid tier — the
  // shopify-uninstall-grace worker sweeps shop_subscriptions directly
  // (status + current_period_end) and downgrades once the period truly
  // lapses, since Shopify sends no further webhook at that boundary.
  const isEntitled = ACTIVE_STATUSES.has(sub.status) || inGracePeriod;

  return {
    tier: isEntitled ? tier : 'starter', // SHB-13: force starter once active/grace both end
    status: mapToDbStatus(sub.status),
    isEntitled,
    currentPeriodEnd,
    shopifySubscriptionId: sub.id ?? null,
    shopifySubscriptionName: sub.name ?? null,
  };
}