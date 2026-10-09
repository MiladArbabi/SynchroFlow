import type { Knex } from 'knex';
import { encrypt } from '../../security/encryption.service.js';
import type { ShopifyOAuthAcquisition } from './shopifyOAuthAcquisition.service.js';

export type CredentialPair = Pick<ShopifyOAuthAcquisition,
  'accessToken' | 'refreshToken' | 'accessExpiresAt' | 'refreshExpiresAt' | 'grantedScopes'>;

/** Persist initial credential material atomically with the caller's installation writes. */
export async function persistShopifyAdminCredentials(
  trx: Knex.Transaction,
  installationId: number,
  shopId: number,
  credentials: CredentialPair,
): Promise<void> {
  const material = {
    access_token_encrypted: encrypt(credentials.accessToken),
    refresh_token_encrypted: encrypt(credentials.refreshToken),
    access_expires_at: credentials.accessExpiresAt,
    refresh_expires_at: credentials.refreshExpiresAt,
    granted_scopes: credentials.grantedScopes,
  };
  await trx('shopify_admin_credentials')
    .insert({ installation_id: installationId, shop_id: shopId, ...material })
    .onConflict('installation_id')
    .merge({ ...material, updated_at: trx.fn.now() });
}

export interface ShopifyAdminCredentialRow {
  id: string;
  installation_id: number;
  shop_id: number;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  access_expires_at: Date | null;
  refresh_expires_at: Date | null;
  credential_state: 'ACTIVE' | 'REAUTH_REQUIRED';
  credential_generation: string;
  rotation_lease_token: string | null;
  rotation_lease_expires_at: Date | null;
}

/** Authoritative reads stay on the caller's tenant transaction. */
export async function readShopifyAdminCredential(
  trx: Knex.Transaction,
  shopId: number,
  installationId?: number,
): Promise<ShopifyAdminCredentialRow | undefined> {
  const installationQuery = trx('shopify_app_installations')
    .select('id').where({ shop_id: shopId }).whereNull('uninstalled_at');
  if (installationId !== undefined) installationQuery.where({ id: installationId });
  const installation = await installationQuery.first();
  if (!installation) return undefined;
  return trx<ShopifyAdminCredentialRow>('shopify_admin_credentials')
    .where({ shop_id: shopId, installation_id: installation.id }).first();
}

export async function lockShopifyAdminCredentialRotation(
  trx: Knex.Transaction,
  shopId: number,
): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)',
    ['shopify_admin_credential_rotation', shopId]);
}

/** T1 writes coordination only; credential material and fencing epoch stay intact. */
export async function writeShopifyAdminCredentialRotationLease(
  trx: Knex.Transaction,
  credential: ShopifyAdminCredentialRow,
  leaseToken: string,
  now: Date,
): Promise<void> {
  await trx('shopify_admin_credentials')
    .where({ id: credential.id, shop_id: credential.shop_id })
    .update({
      rotation_lease_token: leaseToken,
      rotation_lease_expires_at: new Date(now.getTime() + 30_000),
      rotation_started_at: now,
    });
}

export interface ShopifyAdminCredentialRotationOwner {
  shopId: number;
  installationId: number;
  generation: string;
  leaseToken: string;
}

/** SQL fences remain authoritative even after the caller's locked reread. */
function ownedCredentialQuery(
  trx: Knex.Transaction,
  credential: ShopifyAdminCredentialRow,
  owner: ShopifyAdminCredentialRotationOwner,
) {
  return trx('shopify_admin_credentials').where({
    id: credential.id,
    shop_id: owner.shopId,
    installation_id: owner.installationId,
    credential_generation: owner.generation,
    rotation_lease_token: owner.leaseToken,
    credential_state: 'ACTIVE',
  }).whereExists(trx('shopify_app_installations').select(trx.raw('1'))
    .whereRaw('?? = ??', [
        'shopify_app_installations.id',
        'shopify_admin_credentials.installation_id',
      ])
    .whereRaw('?? = ??', [
        'shopify_app_installations.shop_id',
        'shopify_admin_credentials.shop_id',
      ])
    .whereNull('shopify_app_installations.uninstalled_at'));
}

const CLEARED_ROTATION_LEASE = {
  rotation_lease_token: null,
  rotation_lease_expires_at: null,
  rotation_started_at: null,
};

function updatedGeneration(rows: Array<{ credential_generation: string }>): string | undefined {
  if (rows.length > 1) throw new Error('SHOPIFY_CREDENTIAL_UPDATE_CARDINALITY');
  return rows.length === 1 ? String(rows[0].credential_generation) : undefined;
}

/** Encrypt the pair once and rotate canonical authority inside the owned transaction. */
export async function replaceOwnedShopifyAdminCredentials(
  trx: Knex.Transaction,
  credential: ShopifyAdminCredentialRow,
  owner: ShopifyAdminCredentialRotationOwner,
  credentials: CredentialPair,
): Promise<string | undefined> {
  const accessTokenEncrypted = encrypt(credentials.accessToken);
  const refreshTokenEncrypted = encrypt(credentials.refreshToken);
  const rows = await ownedCredentialQuery(trx, credential, owner).update({
    access_token_encrypted: accessTokenEncrypted,
    refresh_token_encrypted: refreshTokenEncrypted,
    access_expires_at: credentials.accessExpiresAt,
    refresh_expires_at: credentials.refreshExpiresAt,
    granted_scopes: credentials.grantedScopes,
    credential_generation: trx.raw('?? + 1', ['credential_generation']),
    ...CLEARED_ROTATION_LEASE,
  }).returning('credential_generation');
  const generation = updatedGeneration(rows);
  if (generation === undefined) return undefined;
  return generation;
}

/** Nonterminal outcomes preserve the epoch and predecessor pair exactly. */
export async function releaseOwnedShopifyAdminCredentialLease(
  trx: Knex.Transaction,
  credential: ShopifyAdminCredentialRow,
  owner: ShopifyAdminCredentialRotationOwner,
): Promise<string | undefined> {
  const rows = await ownedCredentialQuery(trx, credential, owner)
    .update(CLEARED_ROTATION_LEASE).returning('credential_generation');
  return updatedGeneration(rows);
}

/** Terminal authority transition is fenced, without erasing credential material. */
export async function markOwnedShopifyAdminCredentialReauthRequired(
  trx: Knex.Transaction,
  credential: ShopifyAdminCredentialRow,
  owner: ShopifyAdminCredentialRotationOwner,
): Promise<string | undefined> {
  const rows = await ownedCredentialQuery(trx, credential, owner).update({
    credential_state: 'REAUTH_REQUIRED',
    credential_generation: trx.raw('?? + 1', ['credential_generation']),
    ...CLEARED_ROTATION_LEASE,
  }).returning('credential_generation');
  return updatedGeneration(rows);
}


export interface ShopifyAdminReconnectInstallation {
  id: number;
  shop_id: number;
  shop_domain: string;
  uninstalled_at: Date | null;
}

/** Exact domain authority includes retained inactive installation rows. */
export async function readShopifyAdminReconnectAuthority(
  trx: Knex.Transaction,
  shopId: number,
  shopDomain: string,
  installationId?: number,
): Promise<{ installation?: ShopifyAdminReconnectInstallation; credential?: ShopifyAdminCredentialRow }> {
  const query = trx<ShopifyAdminReconnectInstallation>('shopify_app_installations')
    .where({ shop_id: shopId, shop_domain: shopDomain });
  if (installationId !== undefined) query.where({ id: installationId });
  const installation = await query.forUpdate().first();
  if (!installation) return {};
  const credential = await trx<ShopifyAdminCredentialRow>('shopify_admin_credentials')
    .where({ shop_id: shopId, installation_id: installation.id }).forUpdate().first();
  return { installation, credential };
}

export interface ShopifyAdminCredentialReconnectOwner extends ShopifyAdminCredentialRotationOwner {
  shopDomain: string;
  installationState: 'ACTIVE' | 'UNINSTALLED';
}

function reconnectInstallationQuery(
  trx: Knex.Transaction,
  owner: ShopifyAdminCredentialReconnectOwner,
) {
  const query = trx('shopify_app_installations').where({
    id: owner.installationId, shop_id: owner.shopId, shop_domain: owner.shopDomain,
  });
  return owner.installationState === 'ACTIVE'
    ? query.whereNull('uninstalled_at') : query.whereNotNull('uninstalled_at');
}

/** SQL ownership includes the exact installation lifecycle, not only the credential epoch. */
function ownedReconnectQuery(
  trx: Knex.Transaction,
  credential: ShopifyAdminCredentialRow,
  owner: ShopifyAdminCredentialReconnectOwner,
) {
  return trx('shopify_admin_credentials').where({
    id: credential.id,
    shop_id: owner.shopId,
    installation_id: owner.installationId,
    credential_generation: owner.generation,
    credential_state: 'REAUTH_REQUIRED',
    rotation_lease_token: owner.leaseToken,
  }).whereExists(reconnectInstallationQuery(trx, owner).select(trx.raw('1')));
}

/** Advance authority once while preserving canonical predecessor material. */
export async function fenceShopifyAdminCredentialReconnect(
  trx: Knex.Transaction,
  credential: ShopifyAdminCredentialRow,
  installation: ShopifyAdminReconnectInstallation,
  leaseToken: string,
  now: Date,
): Promise<string | undefined> {
  const owner: ShopifyAdminCredentialReconnectOwner = {
    shopId: credential.shop_id, installationId: installation.id,
    shopDomain: installation.shop_domain, generation: String(credential.credential_generation),
    leaseToken, installationState: installation.uninstalled_at === null ? 'ACTIVE' : 'UNINSTALLED',
  };
  const rows = await trx('shopify_admin_credentials').where({
    id: credential.id, shop_id: credential.shop_id, installation_id: installation.id,
    credential_generation: credential.credential_generation,
    credential_state: credential.credential_state,
    rotation_lease_token: credential.rotation_lease_token,
  }).whereExists(reconnectInstallationQuery(trx, owner).select(trx.raw('1'))).update({
    credential_generation: trx.raw('?? + 1', ['credential_generation']),
    credential_state: 'REAUTH_REQUIRED',
    rotation_lease_token: leaseToken,
    rotation_lease_expires_at: new Date(now.getTime() + 30_000),
    rotation_started_at: now,
    updated_at: now,
  }).returning('credential_generation');
  return updatedGeneration(rows);
}

/** Canonical replacement and identity/sync metadata share one owner transaction. */
export async function replaceOwnedShopifyAdminReconnectCredentials(
  trx: Knex.Transaction,
  credential: ShopifyAdminCredentialRow,
  owner: ShopifyAdminCredentialReconnectOwner,
  credentials: ShopifyOAuthAcquisition,
  now: Date,
): Promise<{ generation: string; integration: { id: number } } | undefined> {
  const accessTokenEncrypted = encrypt(credentials.accessToken);
  const refreshTokenEncrypted = encrypt(credentials.refreshToken);
  const rows = await ownedReconnectQuery(trx, credential, owner).update({
    access_token_encrypted: accessTokenEncrypted,
    refresh_token_encrypted: refreshTokenEncrypted,
    access_expires_at: credentials.accessExpiresAt,
    refresh_expires_at: credentials.refreshExpiresAt,
    granted_scopes: credentials.grantedScopes,
    credential_state: 'ACTIVE',
    ...CLEARED_ROTATION_LEASE,
    updated_at: now,
  }).returning('credential_generation');
  const generation = updatedGeneration(rows);
  if (generation === undefined) return undefined;

  const installations = await reconnectInstallationQuery(trx, owner).update({
    shop_gid: credentials.shopIdentity.gid,
    scopes: credentials.grantedScopes,
    ...(owner.installationState === 'UNINSTALLED' ? { uninstalled_at: null } : {}),
    updated_at: now,
  }).returning('id');
  if (installations.length !== 1) throw new Error('SHOPIFY_RECONNECT_INSTALLATION_UPDATE_CARDINALITY');

  await trx('shops').where({ id: owner.shopId })
    .update({ base_currency: credentials.shopIdentity.currencyCode ?? 'USD' });
  if (credentials.shopIdentity.ianaTimezone) {
    await trx('shops').where({ id: owner.shopId, timezone_source: 'shopify' })
      .update({ timezone: credentials.shopIdentity.ianaTimezone });
  }

  const integrations = await trx('integrations').insert({
    shop_id: owner.shopId,
    platform: 'shopify',
    platform_shop_name: owner.shopDomain,
    updated_at: now,
  }).onConflict(['shop_id', 'platform']).merge({
    updated_at: now,
  }).returning('id');
  if (integrations.length !== 1) throw new Error('SHOPIFY_RECONNECT_INTEGRATION_UPSERT_CARDINALITY');
  return { generation, integration: integrations[0] };
}

/** Restore prior state only for definitive no-issuance, while retaining the advanced epoch. */
export async function settleOwnedShopifyAdminCredentialReconnect(
  trx: Knex.Transaction,
  credential: ShopifyAdminCredentialRow,
  owner: ShopifyAdminCredentialReconnectOwner,
  state: 'ACTIVE' | 'REAUTH_REQUIRED',
): Promise<string | undefined> {
  const rows = await ownedReconnectQuery(trx, credential, owner).update({
    credential_state: state, ...CLEARED_ROTATION_LEASE, updated_at: trx.fn.now(),
  }).returning('credential_generation');
  return updatedGeneration(rows);
}
