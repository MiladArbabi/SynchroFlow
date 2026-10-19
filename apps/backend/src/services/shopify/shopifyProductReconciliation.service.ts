// apps/backend/src/services/shopify/shopifyProductReconciliation.service.ts
//
// GH-1262 A2.2 B1 — durable, tenant-scoped Shopify product reconciliation.
//
// An equal-timestamp catalog conflict cannot be ordered from webhook data, so
// syncProducts records an obligation on the product's watermark row. This
// service resolves it from an authoritative Shopify read:
//
//   1. discovery   list_shopify_product_reconciliation_tenants(): shop ids only
//   2. claim       withTenant + FORCE RLS; FOR UPDATE SKIP LOCKED; a fresh
//                  gen_random_uuid() claim token and a DB-time lease per claim
//   3. fetch       credential resolution + GraphQL, OUTSIDE any transaction
//   4. apply       withTenant: canonical T2 credential-rotation lock →
//                  installation authority fence (same installation, domain,
//                  not uninstalled, credential ACTIVE) → product advisory lock
//                  → claim fence (token, generation, live lease on
//                  clock_timestamp()) → syncProducts → fenced completion, all
//                  in one short transaction
//   5. failure     fenced by token + live lease; counted only for the claimed
//                  generation; bounded by maxAttempts with capped backoff
//   6. cancel      worker shutdown aborts the fetch and is re-checked before
//                  apply: only this claim's token is released, uncounted, the
//                  obligation stays pending at its generation, no catalog write
//
// The whole Shopify product fetch (every page) shares ONE deadline
// (PRODUCT_RECONCILIATION_FETCH_DEADLINE_MS); expiry is a counted, retryable
// SHOPIFY_PROVIDER_TIMEOUT failure. Cancellation and timeout are told apart by
// signal state, never by error name. Credential resolution (GH-1068) is not
// cancellable; it is awaited to completion and cancellation is checked after.
//
// A superseded worker (expired lease, reclaimed token, newer generation) can
// never write the catalog, complete, or fail the current claim. A snapshot
// fetched under an installation that was uninstalled, replaced or moved to
// re-authentication before apply is released uncounted and never written; a
// routine token refresh (credential_generation advance) does not invalidate it.
// A null product is a bounded retryable failure, never an inferred deletion,
// unless products/delete already tombstoned it. Tombstoned obligations are
// never claimed. Nothing here re-runs opening inventory, order ingestion,
// refund backfill or stock rebuild.

import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import { syncProducts } from './shopifyProducts.core.js';
import { collectShopifyCatalogProduct } from './shopifyCatalogPagination.service.js';
import { GET_PRODUCT_QUERY, GET_PRODUCT_VARIANTS_QUERY } from './shopify.queries.js';
import {
  resolveShopifyAdminCredentialForConsumer,
  type ShopifyAdminCredentialConsumerResult,
} from './shopifyAdminCredentialConsumer.service.js';
import { createShopifyGraphQLClient } from './shopifyClient.service.js';
import { lockShopifyAdminCredentialRotation } from './shopifyAdminCredential.repository.js';

export const PRODUCT_RECONCILIATION_LEASE_MS = 300_000;
export const PRODUCT_RECONCILIATION_MAX_ATTEMPTS = 8;
export const PRODUCT_RECONCILIATION_BACKOFF_BASE_MS = 5_000;
export const PRODUCT_RECONCILIATION_BACKOFF_CAP_MS = 300_000;
/** One deadline for the complete Shopify product fetch, all pages included. */
export const PRODUCT_RECONCILIATION_FETCH_DEADLINE_MS = 120_000;

export type ProductReconciliationOptions = {
  leaseMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  fetchDeadlineMs?: number;
  /** Shutdown cancellation, owned by the worker. */
  signal?: AbortSignal;
};

export type ProductReconciliationClaim = {
  shopId: number;
  externalProductId: string;
  generation: number;
  claimToken: string;
  attempts: number;
};

export type ProductReconciliationState = {
  pending: boolean;
  generation: number;
  attempts: number;
  lastError: string | null;
  claimed: boolean;
  exhausted: boolean;
};

export type ProductReconciliationOutcome = {
  kind: 'APPLIED' | 'STALE_SKIPPED' | 'TOMBSTONED' | 'SUPERSEDED' | 'AUTHORITY_LOST' | 'FAILED' | 'CANCELLED';
  errorCode?: string;
};

type ShopifyGraphqlLike = {
  request: (query: string, opts?: any) => Promise<{ data?: any }>;
};

export type ProductReconciliationDeps = {
  now?: Date;
  resolveCredential?: (input: { shopId: number; now: Date }) => Promise<ShopifyAdminCredentialConsumerResult>;
  createClient?: (input: { accessToken: string; shopDomain: string; shopId: number }) => ShopifyGraphqlLike;
};

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`SHOPIFY_RECONCILE_OPTION_INVALID: ${label}`);
  }
  return resolved;
}

function resolveOptions(options: ProductReconciliationOptions = {}) {
  return {
    leaseMs: positiveInteger(options.leaseMs, PRODUCT_RECONCILIATION_LEASE_MS, 'leaseMs'),
    maxAttempts: positiveInteger(options.maxAttempts, PRODUCT_RECONCILIATION_MAX_ATTEMPTS, 'maxAttempts'),
    backoffBaseMs: positiveInteger(options.backoffBaseMs, PRODUCT_RECONCILIATION_BACKOFF_BASE_MS, 'backoffBaseMs'),
    backoffCapMs: positiveInteger(options.backoffCapMs, PRODUCT_RECONCILIATION_BACKOFF_CAP_MS, 'backoffCapMs'),
    fetchDeadlineMs: positiveInteger(options.fetchDeadlineMs, PRODUCT_RECONCILIATION_FETCH_DEADLINE_MS, 'fetchDeadlineMs'),
  };
}

/** Cross-tenant discovery: shop ids with at least one claimable obligation. */
export async function listProductReconciliationTenants(
  input: { limit?: number } & ProductReconciliationOptions = {}
): Promise<number[]> {
  const options = resolveOptions(input);
  const limit = positiveInteger(input.limit, 20, 'limit');
  const result = await systemQuery(
    db.raw(
      'SELECT shop_id FROM public.list_shopify_product_reconciliation_tenants(?, ?, ?, ?)',
      [limit, options.maxAttempts, options.backoffBaseMs, options.backoffCapMs]
    )
  );
  return (result.rows ?? []).map((row: { shop_id: number }) => Number(row.shop_id));
}

/**
 * Claims at most one obligation of ONE tenant. Every claim and reclaim mints a
 * new token; the lease and backoff are evaluated on database time.
 */
export async function claimProductReconciliation(
  input: { shopId: number } & ProductReconciliationOptions
): Promise<ProductReconciliationClaim | null> {
  const options = resolveOptions(input);
  const shopId = input.shopId;

  const result = await withTenant(shopId, (trx) =>
    trx.raw(
      `UPDATE shopify_product_source_watermarks AS watermark
          SET claim_token = gen_random_uuid(),
              lease_expires_at = clock_timestamp() + make_interval(secs => ? / 1000.0),
              reconcile_last_attempt_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE watermark.id = (
          SELECT candidate.id
            FROM shopify_product_source_watermarks AS candidate
           WHERE candidate.shop_id = ?
             AND candidate.platform = 'shopify'
             AND candidate.reconcile_requested_at IS NOT NULL
             AND NOT candidate.is_deleted
             AND candidate.reconcile_attempts < ?
             AND (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at <= clock_timestamp())
             AND (candidate.reconcile_attempts = 0
                  OR candidate.reconcile_last_attempt_at IS NULL
                  OR candidate.reconcile_last_attempt_at + make_interval(
                       secs => LEAST(?::double precision, ? * power(2, LEAST(candidate.reconcile_attempts - 1, 30))) / 1000.0
                     ) <= clock_timestamp())
           ORDER BY candidate.reconcile_requested_at, candidate.id
           LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING watermark.external_product_id, watermark.reconcile_generation,
                  watermark.claim_token, watermark.reconcile_attempts`,
      [options.leaseMs, shopId, options.maxAttempts, options.backoffCapMs, options.backoffBaseMs]
    )
  );

  const row = result.rows?.[0];
  if (!row) return null;

  const claim: ProductReconciliationClaim = {
    shopId,
    externalProductId: String(row.external_product_id),
    generation: Number(row.reconcile_generation),
    claimToken: String(row.claim_token),
    attempts: Number(row.reconcile_attempts),
  };
  console.info('[SHOPIFY_PRODUCT_RECONCILE_CLAIMED]', {
    shopId,
    externalProductId: claim.externalProductId,
    generation: claim.generation,
    attempts: claim.attempts,
  });
  return claim;
}

/** Tenant-scoped observability of one product's obligation. */
export async function readProductReconciliationState(
  shopId: number,
  externalProductId: string,
  options: ProductReconciliationOptions = {}
): Promise<ProductReconciliationState | null> {
  const { maxAttempts } = resolveOptions(options);
  const result = await withTenant(shopId, (trx) =>
    trx.raw(
      `SELECT reconcile_requested_at IS NOT NULL AS pending,
              reconcile_generation,
              reconcile_attempts,
              reconcile_last_error,
              (claim_token IS NOT NULL AND lease_expires_at > clock_timestamp()) AS claimed
         FROM shopify_product_source_watermarks
        WHERE shop_id = ? AND platform = 'shopify' AND external_product_id = ?`,
      [shopId, externalProductId]
    )
  );
  const row = result.rows?.[0];
  if (!row) return null;
  const pending = row.pending === true;
  const attempts = Number(row.reconcile_attempts);
  return {
    pending,
    generation: Number(row.reconcile_generation),
    attempts,
    lastError: row.reconcile_last_error ?? null,
    claimed: row.claimed === true,
    exhausted: pending && attempts >= maxAttempts,
  };
}

/** Sanitized, machine-readable provider failure code (never raw provider text). */
function providerErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return message.startsWith('[SHOPIFY_CATALOG_PAGINATION_FATAL]')
    ? 'SHOPIFY_CATALOG_PAGINATION_FATAL'
    : 'SHOPIFY_PROVIDER_ERROR';
}

/**
 * Fenced failure: only the current token with a live lease may record it, and
 * an attempt is counted only against the generation that was claimed. A newer
 * generation's obligation is released untouched (SUPERSEDED).
 */
async function recordFailure(
  claim: ProductReconciliationClaim,
  errorCode: string,
  options: ReturnType<typeof resolveOptions>
): Promise<ProductReconciliationOutcome> {
  const result = await withTenant(claim.shopId, (trx) =>
    trx.raw(
      `UPDATE shopify_product_source_watermarks
          SET reconcile_attempts = CASE WHEN reconcile_generation = ? THEN reconcile_attempts + 1 ELSE reconcile_attempts END,
              reconcile_last_error = CASE WHEN reconcile_generation = ? THEN ? ELSE reconcile_last_error END,
              claim_token = NULL,
              lease_expires_at = NULL,
              updated_at = clock_timestamp()
        WHERE shop_id = ? AND platform = 'shopify' AND external_product_id = ?
          AND claim_token = ? AND lease_expires_at > clock_timestamp()
        RETURNING reconcile_attempts, (reconcile_generation = ?) AS same_generation`,
      [claim.generation, claim.generation, errorCode, claim.shopId, claim.externalProductId,
        claim.claimToken, claim.generation]
    )
  );

  const row = result.rows?.[0];
  if (!row || row.same_generation !== true) {
    console.info('[SHOPIFY_PRODUCT_RECONCILE_SUPERSEDED]', {
      shopId: claim.shopId,
      externalProductId: claim.externalProductId,
      generation: claim.generation,
      stage: 'failure',
    });
    return { kind: 'SUPERSEDED' };
  }

  const attempts = Number(row.reconcile_attempts);
  console.warn('[SHOPIFY_PRODUCT_RECONCILE_FAILED]', {
    shopId: claim.shopId,
    externalProductId: claim.externalProductId,
    generation: claim.generation,
    attempts,
    errorCode,
  });
  if (attempts >= options.maxAttempts) {
    console.error('[SHOPIFY_PRODUCT_RECONCILE_EXHAUSTED]', {
      shopId: claim.shopId,
      externalProductId: claim.externalProductId,
      generation: claim.generation,
      attempts,
      errorCode,
    });
  }
  return { kind: 'FAILED', errorCode };
}

/** Completion of the claimed generation; the claim row is already locked by the fence. */
async function completeClaim(trx: Knex.Transaction, claim: ProductReconciliationClaim): Promise<void> {
  const completed = await trx.raw(
    `UPDATE shopify_product_source_watermarks
        SET claim_token = NULL,
            lease_expires_at = NULL,
            reconcile_requested_at = NULL,
            reconcile_attempts = 0,
            reconcile_last_error = NULL,
            updated_at = clock_timestamp()
      WHERE shop_id = ? AND platform = 'shopify' AND external_product_id = ?
        AND claim_token = ? AND reconcile_generation = ?
      RETURNING id`,
    [claim.shopId, claim.externalProductId, claim.claimToken, claim.generation]
  );
  if ((completed.rows ?? []).length !== 1) {
    throw new Error('SHOPIFY_PRODUCT_RECONCILE_COMPLETION_FENCE_LOST');
  }
}

/**
 * A tombstone written by products/delete (before or during the fetch) settles
 * a null-product claim: completed uncounted, like a tombstoned snapshot. The
 * tombstone flag only ever turns on, so no product lock is needed to rely on it.
 */
async function completeTombstonedClaim(claim: ProductReconciliationClaim): Promise<boolean> {
  const completed = await withTenant(claim.shopId, (trx) =>
    trx.raw(
      `UPDATE shopify_product_source_watermarks
          SET claim_token = NULL,
              lease_expires_at = NULL,
              reconcile_requested_at = NULL,
              reconcile_attempts = 0,
              reconcile_last_error = NULL,
              updated_at = clock_timestamp()
        WHERE shop_id = ? AND platform = 'shopify' AND external_product_id = ?
          AND claim_token = ? AND reconcile_generation = ?
          AND lease_expires_at > clock_timestamp()
          AND is_deleted
        RETURNING id`,
      [claim.shopId, claim.externalProductId, claim.claimToken, claim.generation]
    )
  );
  return (completed.rows ?? []).length === 1;
}

/**
 * C3 apply-time installation fence. The caller holds the canonical T2
 * credential-rotation lock, so uninstall, reconnect and reauthentication
 * cannot commit between this check and the catalog write. Mirrors the T2
 * authority predicate except credential_generation: a routine token refresh
 * keeps the same installation and shop, and Shopify catalog truth does not
 * depend on which access token read it.
 */
async function installationAuthorityHolds(
  trx: Knex.Transaction,
  shopId: number,
  credential: { installationId: number; shopDomain: string }
): Promise<boolean> {
  const authority = await trx('shopify_app_installations as installation')
    .join('shopify_admin_credentials as credential', function () {
      this.on('credential.installation_id', '=', 'installation.id')
        .andOn('credential.shop_id', '=', 'installation.shop_id');
    })
    .where({
      'installation.id': credential.installationId,
      'installation.shop_id': shopId,
      'installation.shop_domain': credential.shopDomain,
      'credential.credential_state': 'ACTIVE',
    })
    .whereNull('installation.uninstalled_at')
    .first('installation.id');
  return !!authority;
}

/** Releases ONLY this claim's token; the newer pending generation stays pending. */
async function releaseClaim(trx: Knex.Transaction, claim: ProductReconciliationClaim): Promise<number> {
  const released = await trx.raw(
    `UPDATE shopify_product_source_watermarks
        SET claim_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
      WHERE shop_id = ? AND platform = 'shopify' AND external_product_id = ? AND claim_token = ?
      RETURNING id`,
    [claim.shopId, claim.externalProductId, claim.claimToken]
  );
  return (released.rows ?? []).length;
}

/**
 * Shutdown cancellation: no catalog write, no attempt, no error. Only this
 * token is released (a superseding claim holds another token and is never
 * touched); pending state and generation are left exactly as they are.
 */
async function cancelClaim(
  claim: ProductReconciliationClaim,
  stage: 'credential' | 'fetch' | 'apply'
): Promise<ProductReconciliationOutcome> {
  const released = await withTenant(claim.shopId, (trx) => releaseClaim(trx, claim));
  console.info('[SHOPIFY_PRODUCT_RECONCILE_CANCELLED]', {
    shopId: claim.shopId,
    externalProductId: claim.externalProductId,
    generation: claim.generation,
    stage,
    released: released === 1,
  });
  return { kind: 'CANCELLED' };
}

/**
 * Resolves one claim: credential + authoritative fetch outside any
 * transaction, then a single fenced apply transaction.
 */
export async function processProductReconciliationClaim(
  claim: ProductReconciliationClaim,
  deps: ProductReconciliationDeps = {},
  options: ProductReconciliationOptions = {}
): Promise<ProductReconciliationOutcome> {
  const resolved = resolveOptions(options);
  const now = deps.now ?? new Date();
  const resolveCredential = deps.resolveCredential ?? resolveShopifyAdminCredentialForConsumer;
  const createClient = deps.createClient
    ?? ((input: { accessToken: string; shopDomain: string; shopId: number }) =>
      createShopifyGraphQLClient({
        accessToken: input.accessToken,
        platformShopName: input.shopDomain,
        shopId: input.shopId,
      }) as unknown as ShopifyGraphqlLike);

  const shutdown = options.signal;

  // ── outside any transaction ──────────────────────────────────────────────
  if (shutdown?.aborted) return cancelClaim(claim, 'credential');

  // Credential resolution (GH-1068) owns its refresh side effects and is not
  // cancellable: it is awaited to completion, never raced.
  let credential: ShopifyAdminCredentialConsumerResult;
  try {
    credential = await resolveCredential({ shopId: claim.shopId, now });
  } catch {
    return recordFailure(claim, 'SHOPIFY_CREDENTIAL_ERROR', resolved);
  }
  if (credential.kind !== 'READY') {
    return recordFailure(claim, `SHOPIFY_CREDENTIAL_${credential.kind}`, resolved);
  }
  // The installation the snapshot is read under; re-verified at apply (C3).
  const fetchAuthority = { installationId: credential.installationId, shopDomain: credential.shopDomain };
  if (shutdown?.aborted) return cancelClaim(claim, 'fetch');

  // One deadline for the whole product fetch: every page shares this signal.
  const deadline = AbortSignal.timeout(resolved.fetchDeadlineMs);
  const fetchSignal = shutdown ? AbortSignal.any([shutdown, deadline]) : deadline;

  let edge: any | null;
  try {
    const client = createClient({
      accessToken: credential.accessToken,
      shopDomain: credential.shopDomain,
      shopId: claim.shopId,
    });
    edge = await collectShopifyCatalogProduct({
      client,
      productQuery: GET_PRODUCT_QUERY,
      variantsQuery: GET_PRODUCT_VARIANTS_QUERY,
      shopId: claim.shopId,
      productId: claim.externalProductId,
      signal: fetchSignal,
    });
  } catch (error) {
    // Classified by signal state: the SDK rewraps abort errors.
    if (shutdown?.aborted) return cancelClaim(claim, 'fetch');
    if (deadline.aborted) return recordFailure(claim, 'SHOPIFY_PROVIDER_TIMEOUT', resolved);
    return recordFailure(claim, providerErrorCode(error), resolved);
  }

  if (shutdown?.aborted) return cancelClaim(claim, 'apply');

  if (edge === null) {
    // Never an inferred deletion: products/delete remains the only tombstone
    // writer. An existing tombstone settles the claim without a counted retry.
    if (await completeTombstonedClaim(claim)) {
      console.info('[SHOPIFY_PRODUCT_RECONCILE_TOMBSTONED]', {
        shopId: claim.shopId,
        externalProductId: claim.externalProductId,
        generation: claim.generation,
        stage: 'not_found',
      });
      return { kind: 'TOMBSTONED' };
    }
    return recordFailure(claim, 'SHOPIFY_PRODUCT_NOT_FOUND', resolved);
  }
  if (typeof edge?.node?.updatedAt !== 'string' || edge.node.updatedAt.length === 0) {
    return recordFailure(claim, 'SHOPIFY_PRODUCT_SNAPSHOT_INVALID', resolved);
  }

  // ── one short, fenced apply transaction ──────────────────────────────────
  let outcome: ProductReconciliationOutcome;
  try {
    outcome = await withTenant(claim.shopId, async (trx) => {
      // Lock order: T2 rotation lock BEFORE the product lock taken in syncProducts.
      await lockShopifyAdminCredentialRotation(trx, claim.shopId);
      if (!(await installationAuthorityHolds(trx, claim.shopId, fetchAuthority))) {
        await releaseClaim(trx, claim);
        return { kind: 'AUTHORITY_LOST' as const };
      }

      const [result] = await syncProducts(trx, claim.shopId, [edge], {
        reconcileClaim: { claimToken: claim.claimToken, generation: claim.generation },
      });

      switch (result?.outcome) {
        case 'claim_lost':
          return { kind: 'SUPERSEDED' as const };
        case 'generation_superseded':
          await releaseClaim(trx, claim);
          return { kind: 'SUPERSEDED' as const };
        case 'applied':
          await completeClaim(trx, claim);
          return { kind: 'APPLIED' as const };
        case 'stale':
          await completeClaim(trx, claim);
          return { kind: 'STALE_SKIPPED' as const };
        case 'tombstoned':
          await completeClaim(trx, claim);
          return { kind: 'TOMBSTONED' as const };
        default:
          throw new Error(`SHOPIFY_PRODUCT_RECONCILE_UNEXPECTED_OUTCOME: ${String(result?.outcome)}`);
      }
    });
  } catch (error) {
    console.error('[SHOPIFY_PRODUCT_RECONCILE_APPLY_ERROR]', {
      shopId: claim.shopId,
      externalProductId: claim.externalProductId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return recordFailure(claim, 'SHOPIFY_PRODUCT_RECONCILE_APPLY_FAILED', resolved);
  }

  console.info(`[SHOPIFY_PRODUCT_RECONCILE_${outcome.kind}]`, {
    shopId: claim.shopId,
    externalProductId: claim.externalProductId,
    generation: claim.generation,
  });
  return outcome;
}

/**
 * One bounded worker tick: at most `limit` tenants, at most one claim per
 * tenant, processed with at most `concurrency` claims in flight.
 */
export async function runProductReconciliationTick(
  input: {
    limit?: number;
    concurrency?: number;
    deps?: ProductReconciliationDeps;
    shouldStop?: () => boolean;
  } & ProductReconciliationOptions = {}
): Promise<{ tenants: number; claimed: number; outcomes: Record<string, number> }> {
  const concurrency = positiveInteger(input.concurrency, 4, 'concurrency');
  const tenants = await listProductReconciliationTenants(input);
  const outcomes: Record<string, number> = {};
  let claimed = 0;
  let next = 0;

  const lane = async () => {
    while (next < tenants.length && !input.shouldStop?.() && !input.signal?.aborted) {
      const shopId = tenants[next++];
      try {
        const claim = await claimProductReconciliation({ ...input, shopId });
        if (!claim) continue;
        claimed++;
        const outcome = await processProductReconciliationClaim(claim, input.deps ?? {}, input);
        outcomes[outcome.kind] = (outcomes[outcome.kind] ?? 0) + 1;
      } catch (error) {
        console.error('[SHOPIFY_PRODUCT_RECONCILE_TENANT_FAILED]', {
          shopId,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tenants.length) }, lane));
  return { tenants: tenants.length, claimed, outcomes };
}
