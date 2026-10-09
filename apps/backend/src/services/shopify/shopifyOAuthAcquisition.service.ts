import axios from 'axios';
import { normalizeAndValidateShopifyGrantedScopes } from './shopifyScopes.js';

export interface ShopifyOAuthAcquisition {
  accessToken: string;
  refreshToken: string;
  grantedScopes: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  shopIdentity: {
    gid: string;
    currencyCode: string | null;
    name: string | null;
    contactEmail: string | null;
    ianaTimezone: string | null;
  };
}

/** Carries only safe diagnostics, never the provider response/request or cause. */
export class ShopifyOAuthAcquisitionError extends Error {
  constructor(
    readonly kind: 'TOKEN_EXCHANGE_FAILURE' | 'SHOP_IDENTITY_FAILURE',
    readonly diagnostics: { message: string; status?: number; code?: string },
    readonly issuance: 'DEFINITIVE_NO_ISSUANCE' | 'POSSIBLY_ISSUED' = 'POSSIBLY_ISSUED',
  ) {
    super(kind);
    this.name = 'ShopifyOAuthAcquisitionError';
  }
}

function providerDiagnostics(err: unknown): {
  message: string;
  status?: number;
  code?: string;
} {
  if (axios.isAxiosError(err)) {
    const status = typeof err.response?.status === 'number'
      && Number.isFinite(err.response.status) ? err.response.status : undefined;
    // Build the message from safe scalars rather than trusting arbitrary text.
    const safeCodes = new Set([
      'ERR_BAD_REQUEST', 'ERR_BAD_RESPONSE', 'ERR_NETWORK', 'ERR_CANCELED',
      'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
      'EAI_AGAIN',
    ]);
    return {
      message: status === undefined
        ? 'Shopify provider request failed'
        : `Request failed with status code ${status}`,
      status,
      code: typeof err.code === 'string' && safeCodes.has(err.code)
        ? err.code : undefined,
    };
  }
  return { message: 'Shopify provider request failed' };
}

function positiveDuration(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** Initial authorization-code acquisition only; all provider work precedes DB work. */
export async function acquireShopifyOAuthCredentials(
  shopDomain: string,
  code: string,
): Promise<ShopifyOAuthAcquisition> {
  let tokenData;
  try {
    const response = await axios.post(
      `https://${shopDomain}/admin/oauth/access_token`,
      {
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
        expiring: 1,
      },
      { timeout: 10_000 },
    );
    tokenData = response.data;
  } catch (err) {
    throw new ShopifyOAuthAcquisitionError(
      'TOKEN_EXCHANGE_FAILURE', providerDiagnostics(err),
      axios.isAxiosError(err) && err.response?.status === 400
        && err.response?.data?.error === 'invalid_grant'
        ? 'DEFINITIVE_NO_ISSUANCE' : 'POSSIBLY_ISSUED',
    );
  }

  const accessToken = tokenData?.access_token;
  const refreshToken = tokenData?.refresh_token;
  const accessDuration = positiveDuration(tokenData?.expires_in);
  const refreshDuration = positiveDuration(tokenData?.refresh_token_expires_in);
  if (
    typeof accessToken !== 'string' || !accessToken.trim()
    || typeof refreshToken !== 'string' || !refreshToken.trim()
    || accessDuration === null || refreshDuration === null
  ) {
    throw new ShopifyOAuthAcquisitionError('TOKEN_EXCHANGE_FAILURE', {
      message: 'Incomplete or invalid Shopify rotating grant',
    });
  }

  // Leave canonical scope exceptions intact for the controller's 403 classifier.
  const grantedScopes = normalizeAndValidateShopifyGrantedScopes(tokenData?.scope);
  const acquiredAt = new Date();
  const accessExpiresAt = new Date(acquiredAt.getTime() + accessDuration * 1000);
  const refreshExpiresAt = new Date(acquiredAt.getTime() + refreshDuration * 1000);
  if (!Number.isFinite(accessExpiresAt.getTime()) || !Number.isFinite(refreshExpiresAt.getTime())) {
    throw new ShopifyOAuthAcquisitionError('TOKEN_EXCHANGE_FAILURE', {
      message: 'Invalid Shopify credential expiry',
    });
  }

  let shop;
  try {
    const response = await axios.post(
      `https://${shopDomain}/admin/api/2024-01/graphql.json`,
      { query: '{ shop { id currencyCode name contactEmail ianaTimezone } }' },
      {
        timeout: 10_000,
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      },
    );
    shop = response.data?.data?.shop;
  } catch (err) {
    throw new ShopifyOAuthAcquisitionError(
      'SHOP_IDENTITY_FAILURE', providerDiagnostics(err),
    );
  }
  if (typeof shop?.id !== 'string' || !/^gid:\/\/shopify\/Shop\/\d+$/.test(shop.id)) {
    throw new ShopifyOAuthAcquisitionError('SHOP_IDENTITY_FAILURE', {
      message: 'Shopify identity response omitted a valid Shop GID',
    });
  }

  return {
    accessToken,
    refreshToken,
    grantedScopes,
    accessExpiresAt,
    refreshExpiresAt,
    shopIdentity: {
      gid: shop.id,
      currencyCode: optionalString(shop.currencyCode),
      name: optionalString(shop.name),
      contactEmail: optionalString(shop.contactEmail),
      ianaTimezone: optionalString(shop.ianaTimezone),
    },
  };
}
