import axios from 'axios';
import { withTenant } from '@lasyncro/backend-core/db.js';

const SHOPIFY_AUTH_URL = 'https://api.shopify.com/auth/access_token';
const SHOPIFY_EVENTS_URL = 'https://api.shopify.com/app/unstable/events';
const DEFAULT_TOKEN_TTL_SECONDS = 3600;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

interface ShopifyTokenResponse {
  access_token?: string;
  scope?: string;
  expires_in?: number;
}

interface CachedToken {
  accessToken: string;
  refreshAt: number;
}

interface ShopifyBillingContext {
  billingProvider: string | null;
  tier: string | null;
  shopGid: string | null;
  periodStartsAt: Date | string | null;
  totalShipped: number;
}

interface ShopifyAppEvent {
  shop_id: string;
  event_handle: string;
  timestamp: string;
  idempotency_key: string;
  attributes: {
    value: number;
  };
}

let cachedToken: CachedToken | null = null;
let pendingTokenRequest: Promise<CachedToken> | null = null;

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

async function mintAccessToken(): Promise<CachedToken> {
  const clientId = requireEnvironmentValue('SHOPIFY_APP_EVENTS_CLIENT_ID');
  const clientSecret = requireEnvironmentValue('SHOPIFY_APP_EVENTS_CLIENT_SECRET');

  const response = await axios.post<ShopifyTokenResponse>(
    SHOPIFY_AUTH_URL,
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
    },
  );

  const accessToken = response.data?.access_token;

  if (!accessToken) {
    throw new Error('Shopify token response omitted access_token');
  }

  // Shopify documents a 60-minute TTL. Some successful responses omit
  // expires_in, so retain the documented TTL as an explicit fallback.
  const reportedTtl = Number(response.data?.expires_in);
  const ttlSeconds =
    Number.isFinite(reportedTtl) && reportedTtl > 0
      ? reportedTtl
      : DEFAULT_TOKEN_TTL_SECONDS;

  console.info('[shopify.events] access token acquired', {
    scope: response.data?.scope ?? 'not_returned',
    ttlSeconds,
  });

  return {
    accessToken,
    refreshAt:
      Date.now() +
      ttlSeconds * 1000 -
      Math.min(TOKEN_REFRESH_BUFFER_MS, (ttlSeconds * 1000) / 2),
  };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.refreshAt) {
    return cachedToken.accessToken;
  }

  if (!pendingTokenRequest) {
    pendingTokenRequest = mintAccessToken();
  }

  try {
    cachedToken = await pendingTokenRequest;
    return cachedToken.accessToken;
  } finally {
    pendingTokenRequest = null;
  }
}

async function loadBillingContext(
  shopId: number,
): Promise<ShopifyBillingContext> {
  return withTenant(shopId, async (trx) => {
    // A Knex transaction owns one PostgreSQL client; keep tenant-scoped
    // reads sequential to avoid overlapping queries on that client.
    const subscription = await trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('billing_provider', 'tier');

    const installation = await trx('shopify_app_installations')
      .where({ shop_id: shopId })
      .whereNull('uninstalled_at')
      .first('shop_gid');

    const usage = await trx('shop_usage_metrics')
      .where({ shop_id: shopId })
      .whereNull('period_ends_at')
      .first('period_starts_at', 'shipped_orders');

    return {
      billingProvider: subscription?.billing_provider ?? null,
      tier: subscription?.tier ?? null,
      shopGid: installation?.shop_gid ?? null,
      periodStartsAt: usage?.period_starts_at ?? null,
      totalShipped: Number(usage?.shipped_orders ?? 0),
    };
  });
}

function buildIdempotencyKey(
  shopId: number,
  periodStartsAt: Date | string,
  totalShipped: number,
): string {
  const periodEpoch = Math.floor(new Date(periodStartsAt).getTime() / 1000);

  if (!Number.isFinite(periodEpoch)) {
    throw new Error('Current usage period has an invalid start timestamp');
  }

  const key = `so_${shopId}_${periodEpoch}_${totalShipped}`;

  if (key.length > 64) {
    throw new Error('Shopify App Event idempotency key exceeds 64 characters');
  }

  return key;
}

async function submitEvent(
  event: ShopifyAppEvent,
  accessToken: string,
): Promise<void> {
  const response = await axios.post(SHOPIFY_EVENTS_URL, event, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: REQUEST_TIMEOUT_MS,
  });

  if (response.status !== 202) {
    throw new Error(`Shopify App Events returned HTTP ${response.status}`);
  }
}

/**
 * Reports already-calculated shipped-order overage units to Shopify.
 *
 * Non-fatal by design: fulfillment must complete even when billing reporting
 * fails. Every skip, acceptance, and failure emits an explicit operator signal.
 */
export async function reportShopifyOverageEvent(
  shopId: number,
  overageUnits: number,
): Promise<void> {
  try {
    if (!Number.isSafeInteger(overageUnits) || overageUnits <= 0) {
      console.warn('[shopify.events] report skipped', {
        shopId,
        reason: 'overage_units_must_be_a_positive_integer',
        overageUnits,
      });
      return;
    }

    const context = await loadBillingContext(shopId);

    if (context.billingProvider !== 'shopify') {
      console.info('[shopify.events] report skipped', {
        shopId,
        reason: 'billing_provider_is_not_shopify',
        billingProvider: context.billingProvider,
      });
      return;
    }

    if (context.tier === 'scale') {
      console.info('[shopify.events] report skipped', {
        shopId,
        reason: 'scale_has_unlimited_shipped_orders',
      });
      return;
    }

    if (!context.shopGid) {
      console.error('[shopify.events] report failed (non-fatal)', {
        shopId,
        reason: 'active_installation_has_no_shop_gid',
      });
      return;
    }

    if (!context.periodStartsAt) {
      console.error('[shopify.events] report failed (non-fatal)', {
        shopId,
        reason: 'no_open_usage_period',
      });
      return;
    }

    if (!Number.isSafeInteger(context.totalShipped)) {
      throw new Error('Current shipped-order total is not a safe integer');
    }

    const eventHandle = requireEnvironmentValue(
      'SHOPIFY_APP_EVENTS_METER_HANDLE',
    );

    const event: ShopifyAppEvent = {
      shop_id: context.shopGid,
      event_handle: eventHandle,
      timestamp: new Date().toISOString(),
      idempotency_key: buildIdempotencyKey(
        shopId,
        context.periodStartsAt,
        context.totalShipped,
      ),
      attributes: {
        value: overageUnits,
      },
    };

    let accessToken = await getAccessToken();

    try {
      await submitEvent(event, accessToken);
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 401) {
        throw error;
      }

      // Retry once with a fresh token; the permanent idempotency key prevents
      // an accepted first request from becoming a duplicate billing event.
      cachedToken = null;
      accessToken = await getAccessToken();
      await submitEvent(event, accessToken);
    }

    // HTTP 202 means Shopify accepted the event for asynchronous processing.
    // Billing outcome must be confirmed separately in Dev Dashboard logs.
    console.info('[shopify.events] billing event accepted', {
      shopId,
      overageUnits,
      totalShipped: context.totalShipped,
      idempotencyKey: event.idempotency_key,
    });
  } catch (error) {
    console.error('[shopify.events] report failed (non-fatal)', {
      shopId,
      overageUnits,
      error: errorMessage(error),
    });
  }
}