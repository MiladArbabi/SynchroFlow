import { withTenant } from '@lasyncro/backend-core/db.js';
import { decrypt } from '../../security/encryption.service.js';
import {
  resolveShopifyAdminCredential,
  finalizeShopifyAdminCredentialRotation,
  settleShopifyAdminCredentialRotation,
  type ShopifyAdminCredentialCompletion,
} from './shopifyAdminCredentialLifecycle.service.js';
import { refreshShopifyAdminCredential } from './shopifyAdminCredentialRefreshProvider.service.js';
import { lockShopifyAdminCredentialRotation, readShopifyAdminCredential } from './shopifyAdminCredential.repository.js';
import { hasUnresolvedShopifyDisconnect, SHOPIFY_DISCONNECT_ATTEMPTS } from './shopifyDisconnectAttempt.repository.js';
import {
  hasUnresolvedShopifyUninstallVerification,
  SHOPIFY_UNINSTALL_VERIFICATIONS,
} from './shopifyUninstallVerification.repository.js';

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
  const installation = await withTenant(shopId, async trx => {
    const row = await trx('shopify_app_installations as installation')
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
      .first<{ id: number; shop_domain: string }>();
    // GH-979 C: no provider work while an owner disconnect is unresolved.
    if (row && await hasUnresolvedShopifyDisconnect(trx, shopId, row.id)) return 'DISCONNECT_UNRESOLVED' as const;
    if (row && await hasUnresolvedShopifyUninstallVerification(trx, shopId, row.id)) {
      return 'UNINSTALL_VERIFICATION_UNRESOLVED' as const;
    }
    return row;
  });
  if (installation === 'DISCONNECT_UNRESOLVED') return { kind: 'REAUTH_REQUIRED' };
  if (installation === 'UNINSTALL_VERIFICATION_UNRESOLVED') {
    return { kind: 'REAUTH_REQUIRED' };
  }
  if (!installation) return { kind: 'RETRYABLE' };
  return { kind: 'READY', accessToken: current.accessToken,
    installationId: installation.id, shopDomain: installation.shop_domain,
    generation: current.generation };
}

/** Exact, read-only authority for the leased uninstall-verification worker. */
export async function resolveShopifyAdminCredentialForUninstallVerification(
  input: { shopId: number; verificationId: string; claimToken: string },
): Promise<
  | { kind: 'READY'; accessToken: string; shopDomain: string; installationId: number; generation: string }
  | { kind: 'UNAVAILABLE' | 'SUPERSEDED' }
> {
  const pinned = await withTenant(input.shopId, async trx => {
    await lockShopifyAdminCredentialRotation(trx, input.shopId);
    const verification = await trx(SHOPIFY_UNINSTALL_VERIFICATIONS)
      .where({ id: input.verificationId, shop_id: input.shopId, claim_token: input.claimToken,
        status: 'PROCESSING' })
      .whereRaw('lease_expires_at > pg_catalog.now()')
      .first('observed_installation_id', 'observed_credential_generation', 'shop_domain');
    if (!verification || verification.observed_installation_id === null) return { kind: 'UNAVAILABLE' } as const;
    const installation = await trx('shopify_app_installations')
      .where({ id: verification.observed_installation_id, shop_id: input.shopId })
      .first('uninstalled_at', 'shop_domain');
    if (!installation || installation.uninstalled_at !== null
      || installation.shop_domain !== verification.shop_domain) return { kind: 'SUPERSEDED' } as const;
    const credential = await readShopifyAdminCredential(trx, input.shopId, verification.observed_installation_id);
    if (!credential || String(credential.credential_generation) !== String(verification.observed_credential_generation)) {
      return { kind: 'SUPERSEDED' } as const;
    }
    if (credential.credential_state !== 'ACTIVE' || !credential.access_token_encrypted
      || (credential.access_expires_at?.getTime() ?? -Infinity) <= Date.now()) {
      return { kind: 'UNAVAILABLE' } as const;
    }
    return { kind: 'READY', encrypted: credential.access_token_encrypted,
      shopDomain: installation.shop_domain, installationId: credential.installation_id,
      generation: String(credential.credential_generation) } as const;
  });
  if (pinned.kind !== 'READY') return pinned;
  return { kind: 'READY', accessToken: decrypt(pinned.encrypted, 'shopify.adminCredential.lifecycle'),
    shopDomain: pinned.shopDomain, installationId: pinned.installationId, generation: pinned.generation };
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

/**
 * GH-979 C reconciliation only: the exact access token pinned by an unresolved
 * disconnect attempt, for one read-only provider check. Never refreshes, never
 * claims a lease and never resolves a different installation, generation or
 * credential material. Anything else is UNAVAILABLE.
 */
export async function resolveShopifyAdminCredentialForDisconnectReconciliation(
  input: { shopId: number; attemptId: string },
): Promise<{ kind: 'READY'; accessToken: string; shopDomain: string } | { kind: 'UNAVAILABLE' }> {
  const pinned = await withTenant(input.shopId, async trx => {
    await lockShopifyAdminCredentialRotation(trx, input.shopId);
    const attempt = await trx(SHOPIFY_DISCONNECT_ATTEMPTS)
      .where({ id: input.attemptId, shop_id: input.shopId })
      .first('installation_id', 'shop_domain', 'credential_generation');
    if (!attempt || !await hasUnresolvedShopifyDisconnect(trx, input.shopId, attempt.installation_id)) return null;
    const credential = await readShopifyAdminCredential(trx, input.shopId, attempt.installation_id);
    const usable = !!credential && credential.credential_state === 'ACTIVE'
      && String(credential.credential_generation) === String(attempt.credential_generation)
      && !!credential.access_token_encrypted
      && (credential.access_expires_at?.getTime() ?? -Infinity) > Date.now();
    return usable ? { encrypted: credential!.access_token_encrypted!, shopDomain: attempt.shop_domain as string } : null;
  });
  if (!pinned) return { kind: 'UNAVAILABLE' };
  return { kind: 'READY', accessToken: decrypt(pinned.encrypted, 'shopify.adminCredential.lifecycle'),
    shopDomain: pinned.shopDomain };
}
