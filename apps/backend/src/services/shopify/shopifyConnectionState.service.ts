import type { Knex } from 'knex';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { hasUnresolvedShopifyDisconnect } from './shopifyDisconnectAttempt.repository.js';
import { hasUnresolvedShopifyUninstallVerification } from './shopifyUninstallVerification.repository.js';

/**
 * GH-1101 — CANONICAL SHOPIFY CONNECTION STATE
 * --------------------------------------------
 * One tenant-level fact, derived from installation and credential METADATA.
 * Never from users.shopify_connected.
 *
 * Pure read: no decryption, no provider refresh, no lease acquisition and no
 * write. Expiry and leases are judged by database server time. Token and
 * encrypted columns are only tested for presence inside SQL and never leave
 * the database. Inconsistent records fail closed (not connected).
 *
 * Installed, connection readiness, sync health and freshness are distinct
 * facts; this classifier owns only the first two.
 */
export type ShopifyConnectionState =
  | 'NOT_INSTALLED'
  | 'UNINSTALLED'
  | 'CONNECTED'
  | 'REFRESHING'
  | 'REAUTH_REQUIRED'
  | 'UNINSTALL_VERIFICATION_UNRESOLVED'
  | 'RECONNECT_IN_PROGRESS';

export interface ShopifyConnection {
  state: ShopifyConnectionState;
  installed: boolean;
  connected: boolean;
  installationId: number | null;
  shopDomain: string | null;
}

export const isShopifyConnectionReady = (state: ShopifyConnectionState): boolean =>
  state === 'CONNECTED' || state === 'REFRESHING';

function connection(
  state: ShopifyConnectionState,
  installation?: { id: number; shop_domain: string },
): ShopifyConnection {
  return {
    state,
    installed: state !== 'NOT_INSTALLED' && state !== 'UNINSTALLED',
    connected: isShopifyConnectionReady(state),
    installationId: installation ? Number(installation.id) : null,
    shopDomain: installation?.shop_domain ?? null,
  };
}

/** Classify inside the caller's tenant transaction (app.current_tenant = shopId). */
export async function classifyShopifyConnection(
  trx: Knex.Transaction,
  shopId: number,
): Promise<ShopifyConnection> {
  const installations = await trx('shopify_app_installations')
    .where({ shop_id: shopId })
    .orderBy('id', 'desc')
    .select('id', 'shop_domain', 'uninstalled_at');

  if (installations.length === 0) return connection('NOT_INSTALLED');

  const active = installations.filter(row => row.uninstalled_at === null);
  if (active.length === 0) return connection('UNINSTALLED', installations[0]);
  // A single store per tenant: more than one live installation is inconsistent.
  if (active.length > 1) return connection('REAUTH_REQUIRED', active[0]);

  const installation = active[0];
  if (await hasUnresolvedShopifyUninstallVerification(trx, shopId, Number(installation.id))) {
    return connection('UNINSTALL_VERIFICATION_UNRESOLVED', installation);
  }
  const credentials = await trx.raw(`
    SELECT credential.credential_state,
      (credential.access_token_encrypted IS NOT NULL
        AND credential.access_expires_at > pg_catalog.now()) AS access_usable,
      (credential.refresh_token_encrypted IS NOT NULL
        AND credential.refresh_expires_at > pg_catalog.now()) AS refresh_usable,
      (credential.rotation_lease_token IS NOT NULL
        AND credential.rotation_lease_expires_at > pg_catalog.now()) AS lease_live
    FROM public.shopify_admin_credentials AS credential
    WHERE credential.shop_id = ? AND credential.installation_id = ?
  `, [shopId, installation.id]);

  // No credential (legacy bootstrap) or an ambiguous identity: fail closed.
  if (credentials.rows.length !== 1) return connection('REAUTH_REQUIRED', installation);
  const credential = credentials.rows[0];

  if (credential.credential_state === 'ACTIVE') {
    const ready: ShopifyConnectionState | null = credential.access_usable === true ? 'CONNECTED'
      : credential.lease_live === true ? 'REFRESHING'
        : credential.refresh_usable === true ? 'CONNECTED' : null;
    if (ready === null) return connection('REAUTH_REQUIRED', installation);
    // GH-979 C: an unresolved owner disconnect may already have uninstalled the
    // app at Shopify. Readiness is unverified until it resolves: fail closed.
    if (await hasUnresolvedShopifyDisconnect(trx, shopId, Number(installation.id))) {
      return connection('REAUTH_REQUIRED', installation);
    }
    return connection(ready, installation);
  }
  if (credential.credential_state === 'REAUTH_REQUIRED' && credential.lease_live === true) {
    return connection('RECONNECT_IN_PROGRESS', installation);
  }
  return connection('REAUTH_REQUIRED', installation);
}

/** Tenant-scoped read in its own transaction. */
export function readShopifyConnection(shopId: number): Promise<ShopifyConnection> {
  return withTenant(shopId, trx => classifyShopifyConnection(trx, shopId));
}
