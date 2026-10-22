import axios from 'axios';
import { normalizeAndValidateShopifyGrantedScopes } from './shopifyScopes.js';

export type ShopifyAdminCredentialRefreshResult =
  | { kind: 'SUCCESS'; credentials: {
      accessToken: string; refreshToken: string; grantedScopes: string;
      accessExpiresAt: Date; refreshExpiresAt: Date;
    } }
  | { kind: 'RETRYABLE' | 'AMBIGUOUS' | 'REAUTH_REQUIRED' | 'PROVIDER_REJECTED';
      diagnostics?: { status?: number; code?: string } };

type Input = { shopDomain: string; refreshToken: string; now: Date };
const SAFE_TRANSPORT_CODES = new Set([
  'ERR_BAD_REQUEST', 'ERR_BAD_RESPONSE', 'ERR_NETWORK', 'ERR_CANCELED',
  'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
]);

function positiveDuration(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Never propagate provider messages, bodies, request/config objects or causes. */
function classifyFailure(error: unknown): ShopifyAdminCredentialRefreshResult {
  if (!axios.isAxiosError(error)) return { kind: 'RETRYABLE' };
  const status = typeof error.response?.status === 'number'
    && Number.isFinite(error.response.status) ? error.response.status : undefined;
  const code = typeof error.code === 'string' && SAFE_TRANSPORT_CODES.has(error.code)
    ? error.code : undefined;
  const diagnostics = { status, code };
  if (status === 401 && error.response?.data?.error === 'invalid_request') {
    return { kind: 'REAUTH_REQUIRED', diagnostics };
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
    return { kind: 'PROVIDER_REJECTED', diagnostics };
  }
  return { kind: 'RETRYABLE', diagnostics };
}

/** Provider-only refresh acquisition. No DB, finalization or lease cleanup. */
export async function refreshShopifyAdminCredential(
  { shopDomain, refreshToken, now }: Input,
): Promise<ShopifyAdminCredentialRefreshResult> {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  // Misconfiguration never reaches Shopify; RETRYABLE releases the lease unchanged.
  if (typeof clientId !== 'string' || !clientId.trim()
    || typeof clientSecret !== 'string' || !clientSecret.trim()) {
    return { kind: 'RETRYABLE', diagnostics: { code: 'SHOPIFY_CLIENT_CREDENTIALS_MISSING' } };
  }
  let data;
  try {
    const response = await axios.post(
      `https://${shopDomain}/admin/oauth/access_token`,
      // Shopify documents the refresh grant as form-encoded (GH-1046 C1).
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      {
        timeout: 10_000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );
    data = response.data;
  } catch (error) {
    return classifyFailure(error);
  }

  const accessToken = data?.access_token;
  const replacementRefreshToken = data?.refresh_token;
  const accessDuration = positiveDuration(data?.expires_in);
  const refreshDuration = positiveDuration(data?.refresh_token_expires_in);
  if (typeof accessToken !== 'string' || !accessToken.trim()
    || typeof replacementRefreshToken !== 'string' || !replacementRefreshToken.trim()
    || accessDuration === null || refreshDuration === null
    || typeof data?.scope !== 'string'
    || !data.scope.split(',').some((scope: string) => scope.trim().length > 0)) {
    return { kind: 'AMBIGUOUS' };
  }

  let grantedScopes: string;
  try {
    grantedScopes = normalizeAndValidateShopifyGrantedScopes(data.scope);
  } catch (error) {
    return { kind: error instanceof Error && error.message.startsWith('SHOPIFY_REQUIRED_SCOPES_MISSING:')
      ? 'REAUTH_REQUIRED' : 'AMBIGUOUS' };
  }
  const acquiredAt = now.getTime();
  const accessExpiresAt = new Date(acquiredAt + accessDuration * 1000);
  const refreshExpiresAt = new Date(acquiredAt + refreshDuration * 1000);
  if (!Number.isFinite(accessExpiresAt.getTime()) || !Number.isFinite(refreshExpiresAt.getTime())) {
    return { kind: 'AMBIGUOUS' };
  }
  return {
    kind: 'SUCCESS',
    credentials: {
      accessToken,
      refreshToken: replacementRefreshToken,
      grantedScopes,
      accessExpiresAt,
      refreshExpiresAt,
    },
  };
}
