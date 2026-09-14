import type { Tier } from '@lasyncro/backend-core/config/tiers.js';
import { withTenant } from '@lasyncro/backend-core/db.js';
import {
  resolveShopifyPlanHandle,
  type ShopifyRecurringPrice,
} from './shopifyCommercialResolver.service.js';

const PARTNER_API_VERSION = '2026-07';
const SHOP_GID_PATTERN = /^gid:\/\/shopify\/Shop\/\d+$/;
const APP_GID_PATTERN = /^gid:\/\/shopify\/App\/\d+$/;

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

class ShopifyPartnerBillingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 502,
  ) {
    super(message);
  }
}

function starterCanceledState(): ShopifyBillingState {
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

function requiredEnv(name: 'SHOPIFY_PARTNER_ORG_ID' | 'SHOPIFY_PARTNER_API_ACCESS_TOKEN' | 'SHOPIFY_APP_GID'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ShopifyPartnerBillingError(
      `[shopify_billing_reconciliation] missing ${name}`,
      'SHOPIFY_PARTNER_CONFIG_MISSING',
      500,
    );
  }
  return value;
}

async function resolveShopGid(shopId: number): Promise<string> {
  const row = await withTenant(shopId, (trx) =>
    trx('shopify_app_installations')
      .where({ shop_id: shopId })
      .whereNull('uninstalled_at')
      .orderBy('installed_at', 'desc')
      .first('shop_gid'),
  );

  const shopGid = typeof row?.shop_gid === 'string' ? row.shop_gid.trim() : '';
  if (!SHOP_GID_PATTERN.test(shopGid)) {
    throw new ShopifyPartnerBillingError(
      '[shopify_billing_reconciliation] missing or invalid shop_gid',
      'SHOPIFY_SHOP_GID_INVALID',
      409,
    );
  }
  return shopGid;
}

function extractPartnerItems(activeSubscription: any): any[] {
  if (Array.isArray(activeSubscription?.items)) {
    return activeSubscription.items;
  }

  if (Array.isArray(activeSubscription?.lineItems)) {
    return activeSubscription.lineItems
      .map((lineItem: any) => lineItem?.plan?.pricingDetails)
      .filter(Boolean);
  }

  return [];
}

function readCommercialHandle(item: any): string | null {
  const handle = typeof item?.handle === 'string' ? item.handle : item?.planHandle;
  if (typeof handle !== 'string' || handle.trim().length === 0) {
    return null;
  }
  return handle.trim().toLowerCase();
}

function readPrice(item: any): ShopifyRecurringPrice | null {
  const rawPrice = item?.price;
  if (!rawPrice) {
    return null;
  }

  return {
    amount: rawPrice.amount ?? null,
    currencyCode: rawPrice.currencyCode ?? rawPrice.currency ?? null,
  };
}

function readCurrentPeriodEnd(activeSubscription: any): Date | null {
  const value =
    activeSubscription?.currentBillingCycle?.endTime ??
    activeSubscription?.currentPeriodEnd ??
    null;

  return value ? new Date(value) : null;
}

export function normalizePartnerActiveSubscriptionToBillingState(
  activeSubscription: unknown,
): ShopifyBillingState {
  if (!activeSubscription) {
    return starterCanceledState();
  }

  const subscription = activeSubscription as any;
  const items = extractPartnerItems(subscription);
  for (const item of items) {
    const planHandle = readCommercialHandle(item);
    if (!planHandle) {
      continue;
    }

    try {
      const tier = resolveShopifyPlanHandle(planHandle);
      return {
        tier,
        status: 'active',
        isEntitled: true,
        currentPeriodEnd: readCurrentPeriodEnd(subscription),
        shopifySubscriptionId: subscription?.legacySubscriptionId ?? subscription?.id ?? null,
        shopifySubscriptionName: item?.description ?? subscription?.name ?? null,
        planHandle,
        price: readPrice(item),
        interval: subscription?.billingPeriod ?? item?.interval ?? null,
      };
    } catch {
      // Usage handles such as shipped-order are not commercial tier handles.
    }
  }

  throw new ShopifyPartnerBillingError(
    '[shopify_billing_reconciliation] no recognized Partner API commercial plan handle',
    'SHOPIFY_PARTNER_PLAN_UNRESOLVED',
    409,
  );
}

export function isShopifyPartnerBillingError(err: unknown): err is ShopifyPartnerBillingError {
  return err instanceof ShopifyPartnerBillingError;
}

/**
 * Fetch and normalize a shop's live Shopify Managed Pricing state.
 * Provider truth comes from the Partner API activeSubscription query using the
 * stored shop_gid. Missing subscriptions fall back to starter / canceled.
 */
export async function fetchShopifyBillingState(shopId: number): Promise<ShopifyBillingState> {
  const orgId = requiredEnv('SHOPIFY_PARTNER_ORG_ID');
  const token = requiredEnv('SHOPIFY_PARTNER_API_ACCESS_TOKEN');
  const appId = requiredEnv('SHOPIFY_APP_GID');
  if (!APP_GID_PATTERN.test(appId)) {
    throw new ShopifyPartnerBillingError(
      '[shopify_billing_reconciliation] invalid SHOPIFY_APP_GID',
      'SHOPIFY_PARTNER_CONFIG_INVALID',
      500,
    );
  }

  const shopIdGid = await resolveShopGid(shopId);
  const response = await fetch(`https://partners.shopify.com/${orgId}/api/${PARTNER_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        query ShopifyPartnerActiveSubscription($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            shop { id }
            billingPeriod
            cancelAtEndOfCycle
            trialEndsAt
            currentBillingCycle { startTime endTime }
            items {
              handle
              description
              price {
                __typename
                active
                currency
                ... on FlatRatePrice {
                  amount
                }
                ... on TieredPrice {
                  tiersMode
                  tiers {
                    upTo
                    amountPerUnit
                    amount
                  }
                }
              }
              usage {
                quantity
                cost {
                  amount
                  currencyCode
                }
              }
            }
            pendingUpdate { id }
            legacySubscriptionId
          }
        }
      `,
      variables: { appId, shopId: shopIdGid },
    }),
  });

  if (!response.ok) {
    throw new ShopifyPartnerBillingError(
      `[shopify_billing_reconciliation] Partner API request failed: ${response.status}`,
      'SHOPIFY_PARTNER_API_FAILED',
    );
  }

  const json = await response.json();
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new ShopifyPartnerBillingError(
      '[shopify_billing_reconciliation] Partner API returned GraphQL errors',
      'SHOPIFY_PARTNER_API_FAILED',
    );
  }

  const activeSubscription = json?.data?.activeSubscription ?? null;
  const returnedShopGid = activeSubscription?.shop?.id;
  if (returnedShopGid && returnedShopGid !== shopIdGid) {
    throw new ShopifyPartnerBillingError(
      '[shopify_billing_reconciliation] Partner API shop mismatch',
      'SHOPIFY_PARTNER_SHOP_MISMATCH',
      409,
    );
  }

  return normalizePartnerActiveSubscriptionToBillingState(activeSubscription);
}
