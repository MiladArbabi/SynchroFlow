import type { Knex } from 'knex';

/**
 * GH-979 SECTION C — durable disconnect attempt (0219) shared predicates.
 *
 * Metadata only: no credential material is read, decrypted or returned. Every
 * function joins the caller's tenant transaction.
 */
export const SHOPIFY_DISCONNECT_ATTEMPTS = 'shopify_app_disconnect_attempts';

/** At most one per tenant (0219 partial unique index). */
export const DISCONNECT_LIVE_STATUSES = ['CLAIMED', 'UNINSTALL_SENT', 'OUTCOME_UNKNOWN', 'PROVIDER_CONFIRMED'] as const;

/** After the recorded intent: Shopify may already have uninstalled LaSyncro. */
export const DISCONNECT_UNRESOLVED_STATUSES = ['UNINSTALL_SENT', 'OUTCOME_UNKNOWN', 'PROVIDER_CONFIRMED'] as const;

/**
 * True while a post-intent attempt still pins the exact live authority of this
 * installation: installation active and credential material (expiries) the
 * same as when the uninstall intent was recorded. A webhook fence, a reinstall
 * or a reconnect issuing new material ends it; a generation-only advance (a
 * reconnect fence later restored without issuance) does not.
 *
 * Readiness and provider consumers fail closed while this holds.
 */
export async function hasUnresolvedShopifyDisconnect(
  trx: Knex.Transaction,
  shopId: number,
  installationId: number,
): Promise<boolean> {
  const row = await trx(`${SHOPIFY_DISCONNECT_ATTEMPTS} as attempt`)
    .join('shopify_app_installations as installation', function joinInstallation() {
      this.on('installation.id', '=', 'attempt.installation_id')
        .andOn('installation.shop_id', '=', 'attempt.shop_id');
    })
    .join('shopify_admin_credentials as credential', function joinCredential() {
      this.on('credential.installation_id', '=', 'attempt.installation_id')
        .andOn('credential.shop_id', '=', 'attempt.shop_id');
    })
    .where('attempt.shop_id', shopId)
    .andWhere('attempt.installation_id', installationId)
    .whereIn('attempt.status', DISCONNECT_UNRESOLVED_STATUSES)
    .whereNull('installation.uninstalled_at')
    .whereRaw('credential.access_expires_at IS NOT DISTINCT FROM attempt.pinned_access_expires_at')
    .whereRaw('credential.refresh_expires_at IS NOT DISTINCT FROM attempt.pinned_refresh_expires_at')
    .first('attempt.id');
  return !!row;
}
