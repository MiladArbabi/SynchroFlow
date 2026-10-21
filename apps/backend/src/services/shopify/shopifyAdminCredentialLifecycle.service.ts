import crypto from 'crypto';
import type { Knex } from 'knex';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { decrypt } from '../../security/encryption.service.js';
import { normalizeAndValidateShopifyGrantedScopes } from './shopifyScopes.js';
import type { ShopifyOAuthAcquisition } from './shopifyOAuthAcquisition.service.js';
import { refreshShopifyAdminCredential } from './shopifyAdminCredentialRefreshProvider.service.js';
import { executeShopifyReconnectFinalizer } from './shopifyReconnectExecutor.db.js';
import { hasUnresolvedShopifyDisconnect } from './shopifyDisconnectAttempt.repository.js';
import {
  readShopifyAdminCredential,
  lockShopifyAdminCredentialRotation,
  writeShopifyAdminCredentialRotationLease,
  replaceOwnedShopifyAdminCredentials,
  releaseOwnedShopifyAdminCredentialLease,
  markOwnedShopifyAdminCredentialReauthRequired,
  readShopifyAdminReconnectAuthority,
  fenceShopifyAdminCredentialReconnect,
  settleOwnedShopifyAdminCredentialReconnect,
  type ShopifyAdminCredentialReconnectOwner,
  type ShopifyAdminReconnectInstallation,
  type CredentialPair,
  type ShopifyAdminCredentialRotationOwner,
  type ShopifyAdminCredentialRow,
} from './shopifyAdminCredential.repository.js';

export type ShopifyAdminCredentialResolution =
  | { kind: 'READY'; accessToken: string; installationId: number; generation: string }
  | { kind: 'REAUTH_REQUIRED' | 'REFRESH_IN_PROGRESS' }
  | { kind: 'ROTATION_CLAIMED'; leaseToken: string; generation: string;
      refreshTokenEncrypted: string; installationId: number; shopDomain: string };

type Input = { shopId: number; now: Date };
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const DECRYPT_CONTEXT = 'shopify.adminCredential.lifecycle';

function ready(
  credential: ShopifyAdminCredentialRow,
): Extract<ShopifyAdminCredentialResolution, { kind: 'READY' }> {
  return {
    kind: 'READY',
    accessToken: decrypt(credential.access_token_encrypted!, DECRYPT_CONTEXT),
    installationId: credential.installation_id,
    generation: String(credential.credential_generation),
  };
}

/** Undefined means a short, locked T1 claim is needed. No refresh plaintext here. */
function resolveCurrent(
  credential: ShopifyAdminCredentialRow | undefined,
  now: Date,
): ShopifyAdminCredentialResolution | undefined {
  if (!credential || credential.credential_state === 'REAUTH_REQUIRED') {
    return { kind: 'REAUTH_REQUIRED' };
  }
  const accessExpiry = credential.access_expires_at?.getTime() ?? -Infinity;
  const usableAccess = !!credential.access_token_encrypted && accessExpiry > now.getTime();
  if (usableAccess && accessExpiry > now.getTime() + REFRESH_THRESHOLD_MS) return ready(credential);

  if (!credential.refresh_token_encrypted || !credential.refresh_expires_at
    || credential.refresh_expires_at.getTime() <= now.getTime()) {
    return { kind: 'REAUTH_REQUIRED' };
  }
  if (credential.rotation_lease_token
    && (credential.rotation_lease_expires_at?.getTime() ?? -Infinity) > now.getTime()) {
    return usableAccess ? ready(credential) : { kind: 'REFRESH_IN_PROGRESS' };
  }
  return undefined;
}

/** Resolution does not orchestrate provider refresh or persist terminal state. */
export async function resolveShopifyAdminCredential(
  input: Input,
): Promise<ShopifyAdminCredentialResolution> {
  const current = await withTenant(input.shopId, async trx =>
    resolveCurrent(await readShopifyAdminCredential(trx, input.shopId), input.now));
  return current ?? claimShopifyAdminCredentialRotation(input);
}

/** One short transaction: dedicated lock, authoritative reread, lease-only write. */
export async function claimShopifyAdminCredentialRotation(
  { shopId, now }: Input,
): Promise<ShopifyAdminCredentialResolution> {
  return withTenant(shopId, async trx => {
    await lockShopifyAdminCredentialRotation(trx, shopId);
    const credential = await trx('shopify_admin_credentials as credential')
      .join('shopify_app_installations as installation', function () {
        this.on('installation.id', '=', 'credential.installation_id')
          .andOn('installation.shop_id', '=', 'credential.shop_id');
      })
      .select('credential.*', 'installation.shop_domain')
      .where('credential.shop_id', shopId).whereNull('installation.uninstalled_at')
      .first<ShopifyAdminCredentialRow & { shop_domain: string }>();
    const current = resolveCurrent(credential, now);
    if (current) return current;
    // GH-979 C: under this lock, an unresolved disconnect intent forbids any
    // refresh: it would issue new material for an authority Shopify may
    // already have uninstalled, and must not end the fail-closed state.
    if (await hasUnresolvedShopifyDisconnect(trx, shopId, credential!.installation_id)) {
      return { kind: 'REAUTH_REQUIRED' };
    }
    const leaseToken = crypto.randomUUID();
    await writeShopifyAdminCredentialRotationLease(trx, credential!, leaseToken, now);
    return {
      kind: 'ROTATION_CLAIMED',
      leaseToken,
      generation: credential!.credential_generation,
      refreshTokenEncrypted: credential!.refresh_token_encrypted!,
      installationId: credential!.installation_id,
      shopDomain: credential!.shop_domain,
    };
  });
}

type RotationInput = ShopifyAdminCredentialRotationOwner & { now: Date };
type CurrentAuthority =
  | { kind: 'READY'; accessToken: string; installationId: number; generation: string }
  | { kind: 'REAUTH_REQUIRED' | 'REFRESH_IN_PROGRESS' | 'RETRYABLE' };
export type ShopifyAdminCredentialCompletion =
  | { kind: 'ROTATED' | 'REAUTH_REQUIRED'; generation: string }
  | { kind: 'LEASE_RELEASED' }
  | { kind: 'STALE_RESULT'; current: CurrentAuthority };

type SettlementOutcome = { kind: 'RETRYABLE' | 'PROVIDER_REJECTED' | 'AMBIGUOUS' | 'REAUTH_REQUIRED' };

function ownsRotation(
  credential: ShopifyAdminCredentialRow | undefined,
  owner: ShopifyAdminCredentialRotationOwner,
): credential is ShopifyAdminCredentialRow {
  return !!credential && credential.shop_id === owner.shopId
    && credential.installation_id === owner.installationId
    && credential.credential_state === 'ACTIVE'
    && String(credential.credential_generation) === owner.generation
    && typeof owner.leaseToken === 'string' && owner.leaseToken.length > 0
    && credential.rotation_lease_token === owner.leaseToken;
}

/** Current winner only: never reuse a stale provider pair or initiate another claim. */
async function staleRotationResult(
  trx: Knex.Transaction,
  { shopId, now }: RotationInput,
): Promise<Extract<ShopifyAdminCredentialCompletion, { kind: 'STALE_RESULT' }>> {
  const current = await readShopifyAdminCredential(trx, shopId);
  let authority: CurrentAuthority;
  if (!current || current.credential_state === 'REAUTH_REQUIRED') {
    authority = { kind: 'REAUTH_REQUIRED' };
  } else if (current.access_token_encrypted
    && (current.access_expires_at?.getTime() ?? -Infinity) > now.getTime()) {
    authority = ready(current);
  } else {
    authority = { kind: current.rotation_lease_token
      && (current.rotation_lease_expires_at?.getTime() ?? -Infinity) > now.getTime()
      ? 'REFRESH_IN_PROGRESS' : 'RETRYABLE' };
  }
  return { kind: 'STALE_RESULT', current: authority };
}

/** T2 atomically rotates canonical authority and ACCESS-only compatibility shadows. */
export async function finalizeShopifyAdminCredentialRotation(
  input: RotationInput & { credentials: CredentialPair },
): Promise<ShopifyAdminCredentialCompletion> {
  return withTenant(input.shopId, async trx => {
    await lockShopifyAdminCredentialRotation(trx, input.shopId);
    const credential = await readShopifyAdminCredential(trx, input.shopId, input.installationId);
    if (!ownsRotation(credential, input)) return staleRotationResult(trx, input);
    const credentials = { ...input.credentials,
      grantedScopes: normalizeAndValidateShopifyGrantedScopes(input.credentials.grantedScopes) };
    const generation = await replaceOwnedShopifyAdminCredentials(trx, credential, input, credentials);
    if (generation === undefined) return staleRotationResult(trx, input);
    return { kind: 'ROTATED', generation };
  });
}

/** One fenced transaction; DB/encryption failures propagate and roll it back. */
export async function settleShopifyAdminCredentialRotation(
  input: RotationInput & { outcome: SettlementOutcome },
): Promise<ShopifyAdminCredentialCompletion> {
  return withTenant(input.shopId, async trx => {
    await lockShopifyAdminCredentialRotation(trx, input.shopId);
    const credential = await readShopifyAdminCredential(trx, input.shopId, input.installationId);
    if (!ownsRotation(credential, input)) return staleRotationResult(trx, input);
    if (input.outcome.kind === 'REAUTH_REQUIRED') {
      const generation = await markOwnedShopifyAdminCredentialReauthRequired(trx, credential, input);
      if (generation === undefined) return staleRotationResult(trx, input);
      return { kind: 'REAUTH_REQUIRED', generation };
    }
    if (!['RETRYABLE', 'PROVIDER_REJECTED', 'AMBIGUOUS'].includes(input.outcome.kind)) {
      throw new Error('SHOPIFY_ROTATION_SETTLEMENT_KIND_INVALID');
    }
    const generation = await releaseOwnedShopifyAdminCredentialLease(trx, credential, input);
    if (generation === undefined) return staleRotationResult(trx, input);
    return { kind: 'LEASE_RELEASED' };
  });
}


export type ShopifyAdminCredentialReconnectPrepared = ShopifyAdminCredentialReconnectOwner & {
  kind: 'RECONNECT_PREPARED';
  mode: 'RECONNECT' | 'REINSTALL';
  priorCredentialState: 'ACTIVE' | 'REAUTH_REQUIRED';
  now: Date;
};
export type ShopifyAdminCredentialReconnectPreparation =
  | ShopifyAdminCredentialReconnectPrepared
  | { kind: 'FIRST_INSTALL' }
  | { kind: 'LEGACY_BOOTSTRAP_EXISTING_INSTALLATION'; installationId: number }
  | { kind: 'REFRESH_IN_PROGRESS' | 'RETRYABLE' };

type ReconnectInput = ShopifyAdminCredentialReconnectOwner & { now: Date };
type ReconnectRecovery = {
  kind: 'RECOVERY_CLAIMED';
  owner: RotationInput;
  refreshTokenEncrypted: string;
};

function liveProviderLease(credential: ShopifyAdminCredentialRow, now: Date): boolean {
  return !!credential.rotation_lease_token
    && (credential.rotation_lease_expires_at?.getTime() ?? -Infinity) > now.getTime();
}

/** One locked classification/claim/fence. Provider HTTP is never executed here. */
async function prepareReconnectTransaction(
  input: { shopId: number; shopDomain: string; now: Date },
  recovered: boolean,
): Promise<ShopifyAdminCredentialReconnectPreparation | ReconnectRecovery> {
  return withTenant(input.shopId, async trx => {
    await lockShopifyAdminCredentialRotation(trx, input.shopId);
    const { installation, credential } = await readShopifyAdminReconnectAuthority(
      trx, input.shopId, input.shopDomain);
    if (!installation) return { kind: 'FIRST_INSTALL' };
    if (!credential) return {
      kind: 'LEGACY_BOOTSTRAP_EXISTING_INSTALLATION', installationId: installation.id,
    };
    // Any live provider lease wins, regardless of access usability or business state.
    if (liveProviderLease(credential, input.now)) return { kind: 'REFRESH_IN_PROGRESS' };

    const due = credential.credential_state === 'ACTIVE' && installation.uninstalled_at === null
      && (credential.access_expires_at?.getTime() ?? -Infinity)
        <= input.now.getTime() + REFRESH_THRESHOLD_MS;
    const usableRefresh = !!credential.refresh_token_encrypted
      && (credential.refresh_expires_at?.getTime() ?? -Infinity) > input.now.getTime();
    if (due && usableRefresh) {
      if (recovered) return { kind: 'RETRYABLE' };
      const leaseToken = crypto.randomUUID();
      await writeShopifyAdminCredentialRotationLease(trx, credential, leaseToken, input.now);
      return {
        kind: 'RECOVERY_CLAIMED',
        owner: { shopId: input.shopId, installationId: installation.id,
          generation: String(credential.credential_generation), leaseToken, now: input.now },
        refreshTokenEncrypted: credential.refresh_token_encrypted!,
      };
    }

    const leaseToken = crypto.randomUUID();
    const generation = await fenceShopifyAdminCredentialReconnect(
      trx, credential, installation, leaseToken, input.now);
    if (generation === undefined) return { kind: 'RETRYABLE' };
    return {
      kind: 'RECONNECT_PREPARED',
      mode: installation.uninstalled_at === null ? 'RECONNECT' : 'REINSTALL',
      shopId: input.shopId, shopDomain: input.shopDomain, installationId: installation.id,
      generation, leaseToken, now: input.now,
      priorCredentialState: credential.credential_state,
      installationState: installation.uninstalled_at === null ? 'ACTIVE' : 'UNINSTALLED',
    };
  });
}

/** At most one recovery; its provider operation and owner settlement precede the committed fence. */
export async function prepareShopifyAdminCredentialReconnect(
  input: { shopId: number; shopDomain: string; now: Date },
): Promise<ShopifyAdminCredentialReconnectPreparation> {
  const startedAt = Date.now();
  const prepared = await prepareReconnectTransaction(input, false);
  if (prepared.kind !== 'RECOVERY_CLAIMED') return prepared;
  let refreshToken: string;
  try {
    refreshToken = decrypt(prepared.refreshTokenEncrypted, DECRYPT_CONTEXT);
  } catch (error) {
    await settleShopifyAdminCredentialRotation({ ...prepared.owner, outcome: { kind: 'RETRYABLE' } });
    throw error;
  }
  const result = await refreshShopifyAdminCredential({
    shopDomain: input.shopDomain, refreshToken, now: input.now,
  });
  const completion = result.kind === 'SUCCESS'
    ? await finalizeShopifyAdminCredentialRotation({ ...prepared.owner, credentials: result.credentials })
    : await settleShopifyAdminCredentialRotation({ ...prepared.owner, outcome: result });
  if (completion.kind === 'STALE_RESULT') return { kind: 'RETRYABLE' };
  if (result.kind !== 'SUCCESS' && result.kind !== 'REAUTH_REQUIRED') return { kind: 'RETRYABLE' };
  // Start the reconnect horizon after recovery settles, retaining the caller's clock base.
  const fenceInput = { ...input, now: new Date(input.now.getTime() + Math.max(0, Date.now() - startedAt)) };
  const fenced = await prepareReconnectTransaction(fenceInput, true);
  // A second recovery is deliberately never started.
  return fenced.kind === 'RECOVERY_CLAIMED' ? { kind: 'RETRYABLE' } : fenced;
}

function ownsReconnect(
  installation: ShopifyAdminReconnectInstallation | undefined,
  credential: ShopifyAdminCredentialRow | undefined,
  owner: ReconnectInput,
): credential is ShopifyAdminCredentialRow {
  return !!installation && !!credential
    && installation.id === owner.installationId && installation.shop_id === owner.shopId
    && installation.shop_domain === owner.shopDomain
    && (owner.installationState === 'ACTIVE' ? installation.uninstalled_at === null
      : owner.installationState === 'UNINSTALLED' && installation.uninstalled_at !== null)
    && credential.shop_id === owner.shopId && credential.installation_id === owner.installationId
    && credential.credential_state === 'REAUTH_REQUIRED'
    && String(credential.credential_generation) === owner.generation
    && typeof owner.leaseToken === 'string' && owner.leaseToken.length > 0
    && credential.rotation_lease_token === owner.leaseToken;
}

export type ShopifyAdminCredentialReconnectCompletion =
  | { kind: 'RECONNECTED'; generation: string; integration: { id: number } }
  | { kind: 'LEASE_RELEASED'; generation: string }
  | { kind: 'STALE_RESULT'; current: CurrentAuthority };

/** Owner success replaces authority atomically without advancing the pre-fenced epoch again. */
export async function finalizeShopifyAdminCredentialReconnect(
  input: ReconnectInput & { credentials: ShopifyOAuthAcquisition; recoveryStateHash?: string },
): Promise<ShopifyAdminCredentialReconnectCompletion> {
  // E owns the entire finalization transaction and canonical T2 lock. No sf_app fallback.
  const result = await executeShopifyReconnectFinalizer(
    input, input.credentials, input.recoveryStateHash ?? null);
  if (result.kind === 'STALE_RESULT') {
    return withTenant(input.shopId, trx => staleRotationResult(trx, input));
  }
  return result;
}

/** No-issuance can restore prior ACTIVE; all possibly-issued outcomes remain fail-closed. */
export async function settleShopifyAdminCredentialReconnect(
  input: ReconnectInput & { priorCredentialState: 'ACTIVE' | 'REAUTH_REQUIRED';
    outcome: { kind: 'DEFINITIVE_NO_ISSUANCE' | 'POSSIBLY_ISSUED' } },
): Promise<ShopifyAdminCredentialReconnectCompletion> {
  return withTenant(input.shopId, async trx => {
    await lockShopifyAdminCredentialRotation(trx, input.shopId);
    const { installation, credential } = await readShopifyAdminReconnectAuthority(
      trx, input.shopId, input.shopDomain, input.installationId);
    if (!ownsReconnect(installation, credential, input)) return staleRotationResult(trx, input);
    if (!['DEFINITIVE_NO_ISSUANCE', 'POSSIBLY_ISSUED'].includes(input.outcome.kind)) {
      throw new Error('SHOPIFY_RECONNECT_SETTLEMENT_KIND_INVALID');
    }
    const state = input.outcome.kind === 'DEFINITIVE_NO_ISSUANCE'
      && input.priorCredentialState === 'ACTIVE'
      ? 'ACTIVE' : 'REAUTH_REQUIRED';
    const generation = await settleOwnedShopifyAdminCredentialReconnect(trx, credential, input, state);
    if (generation === undefined) return staleRotationResult(trx, input);
    return { kind: 'LEASE_RELEASED', generation };
  });
}
