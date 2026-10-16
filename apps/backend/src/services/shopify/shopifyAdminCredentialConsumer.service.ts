import { withTenant } from '@lasyncro/backend-core/db.js';
import { decrypt } from '../../security/encryption.service.js';
import {
  resolveShopifyAdminCredential,
  finalizeShopifyAdminCredentialRotation,
  settleShopifyAdminCredentialRotation,
  type ShopifyAdminCredentialCompletion,
} from './shopifyAdminCredentialLifecycle.service.js';
import { refreshShopifyAdminCredential } from './shopifyAdminCredentialRefreshProvider.service.js';

export type ShopifyAdminCredentialConsumerResult =
  | { kind: 'READY'; accessToken: string; shopDomain: string; installationId: number; generation: string }
  | { kind: 'REFRESH_IN_PROGRESS' | 'RETRYABLE' | 'PROVIDER_REJECTED' | 'REAUTH_REQUIRED' };

type CurrentAuthority = Extract<ShopifyAdminCredentialCompletion, { kind: 'STALE_RESULT' }>['current'];

/** Identity metadata only; credential material always comes from lifecycle authority. */
async function consumerResult(
  shopId: number,
  current: CurrentAuthority,
): Promise<ShopifyAdminCredentialConsumerResult> {
  if (current.kind !== 'READY') return { kind: current.kind };
  const installation = await withTenant(shopId, trx =>
    trx('shopify_app_installations as installation')
      .join('shopify_admin_credentials as credential', function () {
        this.on('credential.installation_id', '=', 'installation.id')
          .andOn('credential.shop_id', '=', 'installation.shop_id');
      })
      .select('installation.id', 'installation.shop_domain')
      .where('installation.shop_id', shopId)
      .andWhere('installation.id', current.installationId)
      .andWhere('credential.credential_generation', current.generation)
      .andWhere('credential.credential_state', 'ACTIVE')
      .whereNull('installation.uninstalled_at')
      .first<{ id: number; shop_domain: string }>());
  if (!installation) return { kind: 'RETRYABLE' };
  return { kind: 'READY', accessToken: current.accessToken,
    installationId: installation.id, shopDomain: installation.shop_domain,
    generation: current.generation };
}

/** Short lifecycle transactions commit before the single provider attempt. */
export async function resolveShopifyAdminCredentialForConsumer(
  input: { shopId: number; now: Date },
): Promise<ShopifyAdminCredentialConsumerResult> {
  const resolution = await resolveShopifyAdminCredential(input);
  if (resolution.kind !== 'ROTATION_CLAIMED') return consumerResult(input.shopId, resolution);

  const owner = { shopId: input.shopId, installationId: resolution.installationId,
    generation: resolution.generation, leaseToken: resolution.leaseToken, now: input.now };
  let refreshToken: string;
  try {
    refreshToken = decrypt(resolution.refreshTokenEncrypted, 'shopify.adminCredential.lifecycle');
  } catch (error) {
    const completion = await settleShopifyAdminCredentialRotation({ ...owner, outcome: { kind: 'RETRYABLE' } });
    if (completion.kind === 'STALE_RESULT') return consumerResult(input.shopId, completion.current);
    throw error;
  }
  const provider = await refreshShopifyAdminCredential({
    shopDomain: resolution.shopDomain, refreshToken, now: input.now,
  });
  if (provider.kind === 'SUCCESS') {
    const completion = await finalizeShopifyAdminCredentialRotation({
      ...owner, credentials: provider.credentials,
    });
    if (completion.kind === 'STALE_RESULT') return consumerResult(input.shopId, completion.current);
    if (completion.kind !== 'ROTATED') return { kind: 'REAUTH_REQUIRED' };
    return { kind: 'READY', accessToken: provider.credentials.accessToken,
      installationId: resolution.installationId, shopDomain: resolution.shopDomain,
      generation: String(completion.generation) };
  }

  const completion = await settleShopifyAdminCredentialRotation({
    ...owner, outcome: { kind: provider.kind },
  });
  if (completion.kind === 'STALE_RESULT') return consumerResult(input.shopId, completion.current);
  return { kind: provider.kind === 'AMBIGUOUS' ? 'RETRYABLE' : provider.kind };
}
