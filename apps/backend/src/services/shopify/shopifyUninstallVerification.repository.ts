import type { Knex } from 'knex';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';

export const SHOPIFY_UNINSTALL_VERIFICATIONS = 'shopify_uninstall_verifications';
export const SHOPIFY_UNINSTALL_BLOCKING_STATUSES = ['PENDING', 'PROCESSING', 'UNRESOLVED'] as const;
const MAX_ATTEMPTS = 5;

export interface ShopifyUninstallVerificationClaim {
  id: string;
  shopId: number;
  claimToken: string;
}

const ROTATION_LOCK_NAMESPACE = 'shopify_admin_credential_rotation';

/**
 * Issue one reconnect OAuth state and, for an owner only, bind the
 * ORDER_UNPROVEN receipts visible to the same PostgreSQL statement snapshot.
 * The caller must already have set the tenant context on trx. A later
 * concurrent receipt cannot enter eligible. Returns the number bound.
 */
export async function issueShopifyOAuthStateWithRecoveryBinding(
  trx: Knex.Transaction,
  input: {
    shopId: number; userId: number; state: string;
    shopDomain: string; expiresAt: Date;
  },
): Promise<number> {
  const result = await trx.raw(`
    SELECT * FROM public.issue_shopify_oauth_state_with_recovery(
      ?::integer, ?::integer, ?::text, ?::text, ?::timestamptz
    )
  `, [input.shopId, input.userId, input.state, input.shopDomain, input.expiresAt]);
  const row = result.rows?.[0];
  if (!row || !/^[a-f0-9]{64}$/.test(String(row.oauth_state_hash))) {
    throw new Error('SHOPIFY_OAUTH_ISSUANCE_INVALID');
  }
  return Number(row.authorized_count);
}

export async function recordShopifyUninstallVerification(
  trx: Knex.Transaction,
  input: { shopId: number; eventId: string; shopDomain: string },
): Promise<void> {
  const event = await trx('integration_webhook_events')
    .where({ shop_id: input.shopId, integration: 'shopify', external_event_id: input.eventId,
      event_type: 'app/uninstalled', verified: true })
    .first('id');
  if (!event) throw new Error('SHOPIFY_UNINSTALL_VERIFIED_RECEIPT_REQUIRED');

  const lock = await trx.raw(
    'SELECT pg_try_advisory_xact_lock(hashtext(?), ?) AS acquired',
    [ROTATION_LOCK_NAMESPACE, input.shopId],
  );
  const acquired = lock.rows?.[0]?.acquired === true;
  if (!acquired) {
    await trx(SHOPIFY_UNINSTALL_VERIFICATIONS).insert({
      shop_id: input.shopId,
      webhook_event_id: event.id,
      external_event_id: input.eventId,
      observed_installation_id: null,
      observed_credential_generation: null,
      reconnect_event_watermark_id: null,
      shop_domain: input.shopDomain,
      status: 'UNRESOLVED',
      outcome_code: 'ORDER_UNPROVEN',
    }).onConflict('webhook_event_id').ignore();
    return;
  }

  // READ COMMITTED obtains a new statement snapshot after the canonical lock.
  const authority = await trx('shopify_app_installations as installation')
    .leftJoin('shopify_admin_credentials as credential', function joinCredential() {
      this.on('credential.installation_id', '=', 'installation.id')
        .andOn('credential.shop_id', '=', 'installation.shop_id');
    })
    .where('installation.shop_id', input.shopId)
    .whereNull('installation.uninstalled_at')
    .orderBy('installation.id', 'desc')
    .first('installation.id', 'credential.credential_generation');

  let reconnectWatermark = '0';
  if (authority) {
    const integration = await trx('integrations')
      .where({ shop_id: input.shopId, platform: 'shopify' }).first('id');
    if (!integration) throw new Error('SHOPIFY_UNINSTALL_INTEGRATION_REQUIRED');
    const watermark = await trx('domain_events')
      .where({ shop_id: input.shopId, event_type: 'integration/sync_dispatch_requested' })
      .whereRaw("event_payload->>'source' = 'reconnect'")
      .whereRaw("event_payload->>'integration_id' = ?", [String(integration.id)])
      .whereRaw("event_payload->>'installation_id' = ?", [String(authority.id)])
      .whereRaw("event_payload->>'generation' ~ '^[0-9]+$'")
      .max<{ max: string | null }>('id as max').first();
    reconnectWatermark = watermark?.max == null ? '0' : String(watermark.max);
  }

  const inserted = await trx(SHOPIFY_UNINSTALL_VERIFICATIONS).insert({
    shop_id: input.shopId,
    webhook_event_id: event.id,
    external_event_id: input.eventId,
    observed_installation_id: authority?.id ?? null,
    observed_credential_generation: authority?.credential_generation ?? null,
    reconnect_event_watermark_id: authority ? reconnectWatermark : null,
    shop_domain: input.shopDomain,
    status: authority ? 'PENDING' : 'ALREADY_UNINSTALLED',
    outcome_code: authority ? null : 'NO_ACTIVE_AUTHORITY',
    resolved_at: authority ? null : trx.fn.now(),
  }).onConflict('webhook_event_id').ignore().returning('status');
  // The ledger follows the PERSISTED verification, never this attempt's
  // reading: only a terminal ALREADY_UNINSTALLED receipt is processed here.
  const persisted = inserted[0]?.status ?? (await trx(SHOPIFY_UNINSTALL_VERIFICATIONS)
    .where({ shop_id: input.shopId, webhook_event_id: event.id }).first('status'))?.status;
  if (persisted === 'ALREADY_UNINSTALLED') {
    await trx('integration_webhook_events')
      .where({ id: event.id, shop_id: input.shopId, integration: 'shopify', external_event_id: input.eventId })
      .update({ processing_status: 'processed', processing_error: null });
  }
}

export async function claimShopifyUninstallVerification(): Promise<ShopifyUninstallVerificationClaim | null> {
  const claimed = await systemQuery(db.raw('SELECT * FROM public.claim_shopify_uninstall_verification()'));
  const row = claimed.rows?.[0];
  return row ? { id: String(row.id), shopId: Number(row.shop_id), claimToken: String(row.claim_token) } : null;
}

export interface ShopifyUninstallVerificationAuthority {
  id: string;
  shopId: number;
  claimToken: string;
  externalEventId: string;
  installationId: number;
  generation: string | null;
  shopDomain: string;
  attemptCount: number;
}

export function readOwnedShopifyUninstallVerification(
  claim: ShopifyUninstallVerificationClaim,
): Promise<ShopifyUninstallVerificationAuthority | null> {
  return withTenant(claim.shopId, async trx => {
    const row = await trx(SHOPIFY_UNINSTALL_VERIFICATIONS)
      .where({ id: claim.id, shop_id: claim.shopId, claim_token: claim.claimToken, status: 'PROCESSING' })
      .whereRaw('lease_expires_at > pg_catalog.now()')
      .first('external_event_id', 'observed_installation_id', 'observed_credential_generation',
        'shop_domain', 'attempt_count');
    if (!row || row.observed_installation_id === null) return null;
    return {
      id: claim.id, shopId: claim.shopId, claimToken: claim.claimToken,
      externalEventId: row.external_event_id,
      installationId: Number(row.observed_installation_id),
      generation: row.observed_credential_generation == null ? null : String(row.observed_credential_generation),
      shopDomain: row.shop_domain,
      attemptCount: Number(row.attempt_count),
    };
  });
}

export async function hasUnresolvedShopifyUninstallVerification(
  trx: Knex.Transaction,
  shopId: number,
  installationId: number,
): Promise<boolean> {
  const row = await trx(SHOPIFY_UNINSTALL_VERIFICATIONS)
    .where({ shop_id: shopId })
    .where(function relevantAuthority() {
      this.where({ observed_installation_id: installationId }).orWhereNull('observed_installation_id');
    })
    .whereIn('status', SHOPIFY_UNINSTALL_BLOCKING_STATUSES)
    .first('id');
  return !!row;
}

export async function readUnresolvedShopifyUninstallVerification(
  trx: Knex.Transaction,
  shopId: number,
): Promise<{ status: 'PENDING' | 'PROCESSING' | 'UNRESOLVED'; shopDomain: string } | null> {
  const row = await trx(SHOPIFY_UNINSTALL_VERIFICATIONS)
    .where({ shop_id: shopId }).whereIn('status', SHOPIFY_UNINSTALL_BLOCKING_STATUSES)
    .orderBy('created_at', 'desc').first('status', 'shop_domain');
  return row ? { status: row.status, shopDomain: row.shop_domain } : null;
}

export type ShopifyUninstallVerificationSettlement =
  | 'CURRENT_AUTHORITY_VERIFIED' | 'SUPERSEDED' | 'ALREADY_UNINSTALLED' | 'UNRESOLVED';

export async function settleShopifyUninstallVerification(
  authority: ShopifyUninstallVerificationAuthority,
  status: ShopifyUninstallVerificationSettlement,
  outcomeCode: string,
): Promise<boolean> {
  return withTenant(authority.shopId, async trx => {
    let finalStatus = status;
    let finalOutcome = outcomeCode;
    if (status === 'CURRENT_AUTHORITY_VERIFIED') {
      const current = await trx('shopify_admin_credentials')
        .where({ shop_id: authority.shopId, installation_id: authority.installationId })
        .first('credential_generation');
      // A moved generation alone is never recovery: stay blocking until the
      // proof-backed recovery path or a fresh verification resolves it.
      if (!current || String(current.credential_generation) !== authority.generation) {
        finalStatus = 'UNRESOLVED';
        finalOutcome = 'AUTHORITY_CHANGED';
      }
    }
    const resolved = finalStatus !== 'UNRESOLVED';
    const updated = await trx(SHOPIFY_UNINSTALL_VERIFICATIONS)
      .where({ id: authority.id, shop_id: authority.shopId, claim_token: authority.claimToken, status: 'PROCESSING' })
      .update({
        status: finalStatus,
        outcome_code: finalOutcome,
        claim_token: null,
        lease_expires_at: null,
        next_attempt_at: resolved || authority.attemptCount >= MAX_ATTEMPTS
          ? trx.fn.now() : trx.raw("pg_catalog.now() + interval '5 minutes'"),
        resolved_at: resolved ? trx.fn.now() : null,
        updated_at: trx.fn.now(),
      });
    if (updated !== 1) return false;
    if (resolved) {
      await trx('integration_webhook_events')
        .where({ shop_id: authority.shopId, integration: 'shopify', external_event_id: authority.externalEventId })
        .update({ processing_status: 'processed', processing_error: null });
    }
    return true;
  });
}

export async function nextShopifyUninstallRecoveryShop(): Promise<number | null> {
  const result = await systemQuery(db.raw('SELECT * FROM public.next_shopify_uninstall_recovery_shop()'));
  return result.rows?.[0] ? Number(result.rows[0].shop_id) : null;
}

// Shared verbatim with public.next_shopify_uninstall_recovery_shop() in
// migration 0220 (contract-tested identical), so discovery and settlement admit
// exactly the same rows. Ordered receipts need a later exact reconnect;
// ORDER_UNPROVEN receipts need the committed proof for their bound owner OAuth
// state. Both need current live ACTIVE authority.
const RECOVERY_ELIGIBILITY = `
        verification.status IN ('PENDING', 'PROCESSING', 'UNRESOLVED')
        AND EXISTS (
          SELECT 1
          FROM public.integrations AS integration
          JOIN public.shopify_app_installations AS installation
            ON installation.shop_id = integration.shop_id
           AND installation.shop_domain = integration.platform_shop_name
           AND installation.uninstalled_at IS NULL
          JOIN public.shopify_admin_credentials AS credential
            ON credential.shop_id = installation.shop_id
           AND credential.installation_id = installation.id
           AND credential.credential_state = 'ACTIVE'
          JOIN public.domain_events AS event
            ON event.shop_id = installation.shop_id
           AND event.event_type = 'integration/sync_dispatch_requested'
           AND event.event_payload->>'source' = 'reconnect'
           AND event.event_payload->>'integration_id' = integration.id::text
           AND event.event_payload->>'installation_id' = installation.id::text
           AND CASE WHEN event.event_payload->>'generation' ~ '^[0-9]{1,18}$'
                    THEN (event.event_payload->>'generation')::bigint END
               <= credential.credential_generation
          WHERE integration.shop_id = verification.shop_id
            AND integration.platform = 'shopify'
            AND integration.platform_shop_name = verification.shop_domain
            AND (
              (verification.outcome_code IS DISTINCT FROM 'ORDER_UNPROVEN'
                AND verification.observed_installation_id = installation.id
                AND verification.reconnect_event_watermark_id IS NOT NULL
                AND event.id > verification.reconnect_event_watermark_id)
              OR (verification.outcome_code = 'ORDER_UNPROVEN'
                AND EXISTS (
                  SELECT 1
                  FROM public.shopify_uninstall_recovery_authorizations AS recovery_auth
                  JOIN public.shopify_reconnect_recovery_proofs AS proof
                    ON proof.shop_id = recovery_auth.shop_id
                   AND proof.oauth_state_hash = recovery_auth.oauth_state_hash
                  WHERE recovery_auth.shop_id = verification.shop_id
                    AND recovery_auth.verification_id = verification.id
                    AND proof.integration_id = integration.id
                    AND proof.installation_id = installation.id
                    AND proof.credential_generation::text = event.event_payload->>'generation'))
            )
        )
`;

/**
 * Tenant-scoped, idempotent recovery settlement for a discovered shop (worker)
 * or right after a reconnect commits (OAuth callback). Under the canonical T2
 * rotation lock the eligibility is re-read from committed state and settled by
 * one conditional statement: a concurrent fence, reinstall or stale worker can
 * neither be overwritten nor restore a superseded row. Only superseded receipts
 * are marked processed in the ledger.
 */
export async function settleShopifyUninstallRecovery(shopId: number): Promise<number> {
  return withTenant(shopId, async trx => {
    await trx.raw('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(?), ?)',
      [ROTATION_LOCK_NAMESPACE, shopId]);
    const result = await trx.raw(`
      WITH eligible AS MATERIALIZED (
        SELECT verification.id
        FROM public.shopify_uninstall_verifications AS verification
        WHERE verification.shop_id = ?
          AND ${RECOVERY_ELIGIBILITY}
        FOR UPDATE OF verification
      ), superseded AS (
        UPDATE public.shopify_uninstall_verifications AS target
        SET status = 'SUPERSEDED', outcome_code = 'LATER_RECONNECT_VERIFIED',
            claim_token = NULL, lease_expires_at = NULL, owner_recovery_state_hash = NULL,
            resolved_at = pg_catalog.now(), updated_at = pg_catalog.now()
        FROM eligible
        WHERE target.id = eligible.id
          AND target.shop_id = ?
          AND target.status IN ('PENDING', 'PROCESSING', 'UNRESOLVED')
        RETURNING target.webhook_event_id
      ), processed AS (
        UPDATE public.integration_webhook_events AS ledger
        SET processing_status = 'processed', processing_error = NULL
        FROM superseded
        WHERE ledger.id = superseded.webhook_event_id
          AND ledger.shop_id = ?
          AND ledger.integration = 'shopify'
        RETURNING ledger.id
      )
      SELECT (SELECT count(*)::integer FROM superseded) AS superseded
    `, [shopId, shopId, shopId]);
    return Number(result.rows?.[0]?.superseded ?? 0);
  });
}
