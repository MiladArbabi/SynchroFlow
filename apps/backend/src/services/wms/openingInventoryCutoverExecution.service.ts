// apps/backend/src/services/wms/openingInventoryCutoverExecution.service.ts
//
// GH-1179 Slice E / E02 — OPENING INVENTORY CUTOVER EXECUTOR CORE
// ---------------------------------------------------------------
// Slice D decides WHAT may be sent (immutable generation batches). E02 decides
// WHO may send it and records WHAT happened:
//
// - claim / reclaim one execution per generation under a PostgreSQL-time
//   lease; every authoritative write is a lease CAS, zero rows = stale claim;
// - before EACH dispatch, revalidate current local authority in one
//   REPEATABLE READ snapshot; drift → requires_regeneration, no provider call;
// - commit the dispatch attempt BEFORE provider I/O; no transaction is held
//   open while Shopify is awaited;
// - send exactly the persisted document + canonical variables, pinned to the
//   frozen requested API version, with zero SDK retries;
// - batches run strictly sequentially; anything but confirmed success stops.
//
// E03 (recoverOpeningInventoryCutoverAmbiguity) adds READ-ONLY ambiguity
// readback: a fresh Shopify Location read judges whether a frozen batch that
// may have executed appears applied. Nothing is ever resent; an applied batch
// continues through the same owned-execution path.
//
// E04 (verifyOpeningInventoryCutoverConvergence) is the separate, READ-ONLY
// final certification of a verifying execution: a fresh Shopify Location read
// compared against the frozen generation and current local authority, with
// lines + header + execution + opening_inventory_shopify_synced_at written in
// ONE final REPEATABLE READ transaction. E02/E03 never chain into it.
//
// Out of scope (later Slice E): N+1 regeneration. No entrypoint mutates
// Slice-D rows.

import type { Knex } from 'knex';
import {
  GraphqlQueryError,
  HttpRequestError,
  HttpResponseError,
  HttpThrottlingError,
} from '@shopify/shopify-api';

import { withTenant } from '@lasyncro/backend-core/db.js';

import { decrypt } from '../../security/encryption.service.js';
import { generationFingerprint } from './openingInventoryCutoverGeneration.service.js';
import {
  assertOpeningInventoryPhysicalReadiness,
  buildOpeningInventoryPhysicalTarget,
  OpeningInventoryPhysicalReadinessError,
  OpeningInventoryPhysicalScopeError,
  resolveOpeningInventoryParticipatingWarehouse,
  type OpeningInventoryPhysicalTargetRow,
} from './openingInventoryPhysicalTarget.service.js';
import {
  buildShopifyItemIdentities,
  collectOpeningInventoryLocationEvidence,
  identityFingerprint,
  normalizeShopifyGid,
  OPENING_INVENTORY_SNAPSHOT_QUERY,
  selectShopifyIdentityRows,
  servedShopifyApiVersion,
  type OpeningInventoryLocationEvidence,
  type ShopifyIdentityRow,
  type ShopifyItemIdentity,
  type SnapshotLine,
} from './shopifyOpeningInventorySnapshot.service.js';

const GENERATIONS = 'opening_inventory_cutover_generations';
const GENERATION_ENTRIES = 'opening_inventory_cutover_generation_entries';
const GENERATION_BATCHES = 'opening_inventory_cutover_generation_batches';
const EXECUTIONS = 'opening_inventory_cutover_executions';
const BATCH_EXECUTIONS = 'opening_inventory_cutover_batch_executions';
const ATTEMPTS = 'opening_inventory_cutover_batch_attempts';
const VERIFICATIONS = 'opening_inventory_cutover_verifications';
const VERIFICATION_LINES = 'opening_inventory_cutover_verification_lines';

/** Conservative default; no heartbeat in E02. */
export const OPENING_INVENTORY_CUTOVER_EXECUTION_LEASE_MS = 5 * 60 * 1000;

export const OPENING_CUTOVER_EXECUTION_BUSY = 'OPENING_CUTOVER_EXECUTION_BUSY';
export const OPENING_CUTOVER_EXECUTION_STALE_CLAIM =
  'OPENING_CUTOVER_EXECUTION_STALE_CLAIM';

const REVALIDATION_FAILED = 'OPENING_CUTOVER_EXECUTION_REVALIDATION_FAILED';
const PROVIDER_REJECTED = 'OPENING_CUTOVER_EXECUTION_PROVIDER_REJECTED';
const LEASE_RECLAIMED = 'OPENING_CUTOVER_EXECUTION_LEASE_RECLAIMED';

export const OPENING_CUTOVER_RECOVERY_NOT_AMBIGUOUS =
  'OPENING_CUTOVER_RECOVERY_NOT_AMBIGUOUS';
export const OPENING_CUTOVER_RECOVERY_FROZEN_REQUEST_INTEGRITY =
  'OPENING_CUTOVER_RECOVERY_FROZEN_REQUEST_INTEGRITY';
export const OPENING_CUTOVER_RECOVERY_STRUCTURAL_DRIFT =
  'OPENING_CUTOVER_RECOVERY_STRUCTURAL_DRIFT';
export const OPENING_CUTOVER_RECOVERY_NOT_RECOVERED =
  'OPENING_CUTOVER_RECOVERY_NOT_RECOVERED';
export const OPENING_CUTOVER_RECOVERY_READ_FAILED =
  'OPENING_CUTOVER_RECOVERY_READ_FAILED';
const RECOVERY_INSTALLATION_MISSING = 'OPENING_CUTOVER_RECOVERY_INSTALLATION_MISSING';

export const OPENING_CUTOVER_CONVERGED = 'OPENING_CUTOVER_CONVERGED';
export const OPENING_CUTOVER_ALREADY_CONVERGED = 'OPENING_CUTOVER_ALREADY_CONVERGED';
export const OPENING_CUTOVER_CONVERGENCE_NOT_VERIFYING =
  'OPENING_CUTOVER_CONVERGENCE_NOT_VERIFYING';
export const OPENING_CUTOVER_FINAL_NOT_CONVERGED =
  'OPENING_CUTOVER_FINAL_NOT_CONVERGED';
export const OPENING_CUTOVER_FINAL_LOCAL_DRIFT = 'OPENING_CUTOVER_FINAL_LOCAL_DRIFT';
export const OPENING_CUTOVER_FINAL_STRUCTURAL_DRIFT =
  'OPENING_CUTOVER_FINAL_STRUCTURAL_DRIFT';
export const OPENING_CUTOVER_FINAL_READ_FAILED = 'OPENING_CUTOVER_FINAL_READ_FAILED';
export const OPENING_CUTOVER_FINAL_SERIALIZATION_CONFLICT =
  'OPENING_CUTOVER_FINAL_SERIALIZATION_CONFLICT';
export const OPENING_CUTOVER_LEGACY_COMPLETION_MARKER_PRESENT =
  'OPENING_CUTOVER_LEGACY_COMPLETION_MARKER_PRESENT';

const PG_SERIALIZATION_FAILURE = '40001';

const ERROR_DETAIL_MAX = 2000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── public contract ─────────────────────────────────────────────────────────

export interface ExecuteOpeningInventoryCutoverGenerationParams {
  shopId: number;
  generationId: string;
}

export interface OpeningInventoryCutoverShopifyClient {
  request(
    document: string,
    options: { variables: unknown; retries: number }
  ): Promise<unknown>;
}

export type OpeningInventoryCutoverShopifyClientFactory = (args: {
  accessToken: string;
  platformShopName: string;
  shopId: number;
  apiVersion: string;
}) => OpeningInventoryCutoverShopifyClient;

export interface ExecuteOpeningInventoryCutoverGenerationDeps {
  createShopifyGraphQLClient?: OpeningInventoryCutoverShopifyClientFactory;
  leaseDurationMs?: number;
}

export type OpeningInventoryCutoverExecutionOutcome =
  | 'verifying'
  | 'ambiguous'
  | 'blocked'
  | 'requires_regeneration'
  | 'converged'
  | 'busy'
  | 'stale_claim'
  | 'not_ambiguous'
  | 'not_verifying';

export interface OpeningInventoryCutoverExecutionResult {
  outcome: OpeningInventoryCutoverExecutionOutcome;
  code: string | null;
  generationId: string;
  executionId: string | null;
}

// ─── lease ───────────────────────────────────────────────────────────────────

interface Lease {
  shopId: number;
  generationId: string;
  executionId: string;
  leaseToken: string;
}

class OpeningInventoryCutoverStaleClaimError extends Error {
  readonly code = OPENING_CUTOVER_EXECUTION_STALE_CLAIM;

  constructor() {
    super(
      `[${OPENING_CUTOVER_EXECUTION_STALE_CLAIM}] execution lease is no longer held by this executor`
    );
    this.name = 'OpeningInventoryCutoverStaleClaimError';
  }
}

function leaseExpiry(trx: Knex.Transaction, leaseMs: number) {
  return trx.raw(`now() + (? * interval '1 millisecond')`, [leaseMs]);
}

/** Leased (owned-work) execution states: E02/E03 own executing, E04 verifying. */
type LeasedStatus = 'executing' | 'verifying';

/**
 * Lease CAS inside an open transaction. The row lock it takes serializes
 * against a concurrent reclaim; zero rows = stale.
 */
async function casLease(
  trx: Knex.Transaction,
  lease: Lease,
  expectedStatus: LeasedStatus
): Promise<void> {
  const owned = await trx(EXECUTIONS)
    .where({
      execution_id: lease.executionId,
      shop_id: lease.shopId,
      lease_token: lease.leaseToken,
      status: expectedStatus,
    })
    .whereRaw('lease_expires_at > now()')
    .update({ updated_at: trx.fn.now() })
    .returning('execution_id');

  if (owned.length !== 1) {
    throw new OpeningInventoryCutoverStaleClaimError();
  }
}

/** Every authoritative executor transaction starts with the lease CAS. */
async function withLease<T>(
  lease: Lease,
  fn: (trx: Knex.Transaction) => Promise<T>,
  expectedStatus: LeasedStatus = 'executing'
): Promise<T> {
  return withTenant(lease.shopId, async (trx) => {
    await casLease(trx, lease, expectedStatus);

    return fn(trx);
  });
}

function result(
  outcome: OpeningInventoryCutoverExecutionOutcome,
  params: { generationId: string; executionId: string | null; code?: string | null }
): OpeningInventoryCutoverExecutionResult {
  return {
    outcome,
    code: params.code ?? null,
    generationId: params.generationId,
    executionId: params.executionId,
  };
}

// ─── claim / reclaim ─────────────────────────────────────────────────────────

type Claim =
  | { kind: 'owner'; lease: Lease }
  | { kind: 'done'; result: OpeningInventoryCutoverExecutionResult };

/**
 * `recover` (E03) never creates an execution and never reclaims one whose
 * first unfinished batch is not ambiguous (or an interrupted dispatch, which
 * reclaim turns ambiguous). Busy / terminal handling is identical.
 *
 * `converge` (E04) never creates an execution and owns only a VERIFYING
 * execution: live lease → busy; expired → reclaim the same row. Executing is
 * not convergence work; terminal / blocked states are returned as they are.
 */
type ClaimMode = 'execute' | 'recover' | 'converge';

async function claimExecution(
  shopId: number,
  generationId: string,
  leaseMs: number,
  mode: ClaimMode = 'execute'
): Promise<Claim> {
  return withTenant(shopId, async (trx) => {
    // Same per-shop serialization as Slice-D generation creation.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [
      'opening_inventory_cutover',
      shopId,
    ]);

    const generation = await trx(GENERATIONS)
      .where({ shop_id: shopId, generation_id: generationId })
      .first('generation_id', 'status', 'batch_count');

    if (!generation || generation.status !== 'frozen') {
      throw new Error(
        '[OPENING_CUTOVER_EXECUTION_GENERATION] Frozen opening inventory generation not found'
      );
    }

    const existing = await trx(EXECUTIONS)
      .where({ shop_id: shopId, generation_id: generationId })
      .forUpdate()
      .first(
        'execution_id',
        'status',
        'lease_token',
        trx.raw(
          '(lease_expires_at IS NOT NULL AND lease_expires_at > now()) AS lease_live'
        )
      );

    if (!existing && mode === 'recover') {
      return {
        kind: 'done' as const,
        result: result('not_ambiguous', {
          generationId,
          executionId: null,
          code: OPENING_CUTOVER_RECOVERY_NOT_AMBIGUOUS,
        }),
      };
    }

    if (!existing && mode === 'converge') {
      return {
        kind: 'done' as const,
        result: result('not_verifying', {
          generationId,
          executionId: null,
          code: OPENING_CUTOVER_CONVERGENCE_NOT_VERIFYING,
        }),
      };
    }

    if (!existing) {
      const [created] = await trx(EXECUTIONS)
        .insert({
          shop_id: shopId,
          generation_id: generationId,
          status: 'executing',
          lease_token: trx.raw('gen_random_uuid()'),
          lease_expires_at: leaseExpiry(trx, leaseMs),
        })
        .returning(['execution_id', 'lease_token']);

      const batches = await trx(GENERATION_BATCHES)
        .where({ shop_id: shopId, generation_id: generationId })
        .orderBy('batch_index', 'asc')
        .select('batch_index');

      if (batches.length !== Number(generation.batch_count)) {
        throw new Error(
          '[OPENING_CUTOVER_EXECUTION_INTERNAL] Immutable generation batch count does not match its batches'
        );
      }

      if (batches.length > 0) {
        await trx(BATCH_EXECUTIONS).insert(
          batches.map((batch: { batch_index: number }) => ({
            generation_id: generationId,
            batch_index: batch.batch_index,
            shop_id: shopId,
            execution_id: created.execution_id,
            status: 'pending',
          }))
        );
      }

      return {
        kind: 'owner' as const,
        lease: {
          shopId,
          generationId,
          executionId: String(created.execution_id),
          leaseToken: String(created.lease_token),
        },
      };
    }

    const executionId = String(existing.execution_id);
    const ownedStatus: LeasedStatus = mode === 'converge' ? 'verifying' : 'executing';

    if (existing.status !== ownedStatus) {
      if (mode === 'converge' && existing.status === 'executing') {
        return {
          kind: 'done' as const,
          result: result('not_verifying', {
            generationId,
            executionId,
            code: OPENING_CUTOVER_CONVERGENCE_NOT_VERIFYING,
          }),
        };
      }

      return {
        kind: 'done' as const,
        result: result(existing.status, {
          generationId,
          executionId,
          code:
            mode === 'converge' && existing.status === 'converged'
              ? OPENING_CUTOVER_ALREADY_CONVERGED
              : null,
        }),
      };
    }

    if (existing.lease_live === true) {
      return {
        kind: 'done' as const,
        result: result('busy', {
          generationId,
          executionId,
          code: OPENING_CUTOVER_EXECUTION_BUSY,
        }),
      };
    }

    if (mode === 'recover') {
      const unfinished = await trx(BATCH_EXECUTIONS)
        .where({ shop_id: shopId, execution_id: executionId })
        .whereNot('status', 'succeeded')
        .orderBy('batch_index', 'asc')
        .first('status');

      // Pending / rejected batches need execution, not recovery.
      if (!unfinished || !['ambiguous', 'dispatching'].includes(unfinished.status)) {
        return {
          kind: 'done' as const,
          result: result('not_ambiguous', {
            generationId,
            executionId,
            code: OPENING_CUTOVER_RECOVERY_NOT_AMBIGUOUS,
          }),
        };
      }
    }

    // Expired lease: issue a NEW token; the old token loses authority now.
    const [reclaimed] = await trx(EXECUTIONS)
      .where({
        execution_id: executionId,
        shop_id: shopId,
        status: ownedStatus,
        lease_token: existing.lease_token,
      })
      .whereRaw('lease_expires_at <= now()')
      .update({
        lease_token: trx.raw('gen_random_uuid()'),
        lease_expires_at: leaseExpiry(trx, leaseMs),
        lease_heartbeat_at: null,
        updated_at: trx.fn.now(),
      })
      .returning(['lease_token']);

    if (!reclaimed) {
      throw new Error(
        '[OPENING_CUTOVER_EXECUTION_INTERNAL] Expired execution lease could not be reclaimed'
      );
    }

    const leaseToken = String(reclaimed.lease_token);

    // An unfinalized attempt may already have reached Shopify: never resend.
    // Finalize it once as abandoned under the new lease and leave its batch
    // ambiguous for later Slice-E readback.
    await trx(ATTEMPTS)
      .where({ shop_id: shopId, execution_id: executionId })
      .whereNull('finalized_at')
      .update({
        outcome: 'abandoned',
        finalized_at: trx.fn.now(),
        finalized_by_lease_token: leaseToken,
        error_class: LEASE_RECLAIMED,
        error_detail:
          'Dispatching executor lost its lease before recording a provider result',
      });

    await trx(BATCH_EXECUTIONS)
      .where({ shop_id: shopId, execution_id: executionId, status: 'dispatching' })
      .update({ status: 'ambiguous', updated_at: trx.fn.now() });

    // A readback the old owner left collecting (ambiguity_inspection or
    // final_convergence) can never be finalized by it: abandon it under the
    // new lease before any new inspection begins.
    await trx(VERIFICATIONS)
      .where({ shop_id: shopId, execution_id: executionId, status: 'collecting' })
      .update({
        status: 'abandoned',
        read_completed_at: trx.fn.now(),
        finalized_by_lease_token: leaseToken,
        verdict: null,
      });

    return {
      kind: 'owner' as const,
      lease: { shopId, generationId, executionId, leaseToken },
    };
  });
}

// ─── current-authority revalidation ──────────────────────────────────────────

type Authority =
  | { ok: true; shopDomain: string; encryptedAccessToken: string }
  | { ok: false; reason: string };

/**
 * Current local authority as one consistent capture. Every field is proven
 * equal to the frozen generation by the capture itself; E04 additionally
 * compares two captures (V1 / V2) field by field.
 */
interface CapturedAuthority {
  shopGid: string;
  shopDomain: string;
  encryptedAccessToken: string;
  snapshotId: string;
  warehouseId: string;
  locationGid: string;
  readinessPassed: true;
  targetRows: OpeningInventoryPhysicalTargetRow[];
  targetFingerprint: string;
  identityRows: ShopifyIdentityRow[];
  identityFingerprint: string;
}

type AuthorityCapture =
  | { ok: true; authority: CapturedAuthority }
  | { ok: false; reason: string };

function drift(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/** Deterministic identity-row order (the fingerprint's own key form). */
function canonicalIdentityRows(rows: ShopifyIdentityRow[]): ShopifyIdentityRow[] {
  const key = (row: ShopifyIdentityRow) =>
    JSON.stringify([
      String(row.lasyncro_variant_id),
      row.external_inventory_item_id ?? null,
      row.external_variant_id ?? null,
      row.variant_status ?? null,
      row.product_status ?? null,
      row.product_type ?? null,
    ]);

  return [...rows].sort((left, right) =>
    key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0
  );
}

/**
 * The ONE canonical local-authority algorithm, inside the caller's EXISTING
 * transaction (E02 revalidation, E04 V1 and the E04 final V2 transaction).
 * Read only. Authority errors become drift; anything else propagates.
 */
async function captureCurrentAuthorityInTrx(
  trx: Knex.Transaction,
  shopId: number,
  generationId: string
): Promise<AuthorityCapture> {
  const generation = await trx(GENERATIONS)
    .where({ shop_id: shopId, generation_id: generationId })
    .first();

  if (!generation || generation.status !== 'frozen') {
    return drift('GENERATION_NOT_FROZEN');
  }

  const installation = await trx('shopify_app_installations')
    .where({ shop_id: shopId })
    .whereNull('uninstalled_at')
    .first('shop_domain', 'shop_gid', 'access_token');

  if (!installation?.shop_domain || !installation?.access_token) {
    return drift('INSTALLATION_MISSING');
  }

  if (installation.shop_gid !== generation.shopify_shop_gid) {
    return drift('SHOP_GID_CHANGED');
  }

  let scope: Awaited<ReturnType<typeof resolveOpeningInventoryParticipatingWarehouse>>;
  let target: OpeningInventoryPhysicalTargetRow[];
  let targetFingerprint: string;

  try {
    scope = await resolveOpeningInventoryParticipatingWarehouse(trx, shopId);

    if (
      scope.snapshotId !== String(generation.opening_snapshot_id) ||
      scope.warehouseId !== String(generation.warehouse_id) ||
      normalizeShopifyGid('Location', scope.shopifyLocationId) !==
        generation.shopify_location_gid
    ) {
      return drift('SCOPE_CHANGED');
    }

    const warehouse = await trx('warehouses')
      .where({ shop_id: shopId, warehouse_id: scope.warehouseId })
      .first('external_location_id');

    if (
      !warehouse ||
      normalizeShopifyGid('Location', warehouse.external_location_id) !==
        generation.shopify_location_gid
    ) {
      return drift('LOCATION_MAPPING_CHANGED');
    }

    await assertOpeningInventoryPhysicalReadiness(trx, shopId, scope.warehouseId);

    target = await buildOpeningInventoryPhysicalTarget(
      trx,
      shopId,
      scope.warehouseId
    );

    // Same algorithm and shape Slice D froze.
    targetFingerprint = generationFingerprint(
      target.map((row) => ({
        lasyncroVariantId: row.lasyncroVariantId,
        targetQuantity: row.targetQuantity,
      }))
    );

    if (targetFingerprint !== generation.target_fingerprint) {
      return drift('PHYSICAL_TARGET_CHANGED');
    }
  } catch (error) {
    if (error instanceof OpeningInventoryPhysicalScopeError) {
      return drift(`SCOPE_${error.code}`);
    }

    if (error instanceof OpeningInventoryPhysicalReadinessError) {
      return drift(`PHYSICAL_NOT_READY:${error.reasons.join(',')}`);
    }

    throw error;
  }

  const identityRows = await selectShopifyIdentityRows(trx, shopId);
  const currentIdentityFingerprint = identityFingerprint(identityRows);

  if (currentIdentityFingerprint !== generation.identity_fingerprint) {
    return drift('IDENTITY_CHANGED');
  }

  return {
    ok: true as const,
    authority: {
      shopGid: String(installation.shop_gid),
      shopDomain: String(installation.shop_domain),
      encryptedAccessToken: installation.access_token,
      snapshotId: scope.snapshotId,
      warehouseId: scope.warehouseId,
      locationGid: String(normalizeShopifyGid('Location', scope.shopifyLocationId)),
      readinessPassed: true as const,
      targetRows: target,
      targetFingerprint,
      identityRows: canonicalIdentityRows(identityRows),
      identityFingerprint: currentIdentityFingerprint,
    },
  };
}

/**
 * One REPEATABLE READ snapshot (taken by withTenant's set_config) for every
 * authority read. Read only.
 */
async function revalidateCurrentAuthority(
  shopId: number,
  generationId: string
): Promise<Authority> {
  const captured = await withTenant(
    shopId,
    (trx) => captureCurrentAuthorityInTrx(trx, shopId, generationId),
    { isolationLevel: 'repeatable read' }
  );

  if (captured.ok === false) return captured;

  return {
    ok: true as const,
    shopDomain: captured.authority.shopDomain,
    encryptedAccessToken: captured.authority.encryptedAccessToken,
  };
}

/** Inside a lease-owned transaction: executing → requires_regeneration. */
async function requireRegenerationInTrx(
  trx: Knex.Transaction,
  lease: Lease,
  terminalReason: string
): Promise<void> {
  await trx(EXECUTIONS)
    .where({ execution_id: lease.executionId, shop_id: lease.shopId })
    .update({
      status: 'requires_regeneration',
      terminal_at: trx.fn.now(),
      terminal_reason: terminalReason,
      lease_token: null,
      lease_expires_at: null,
      lease_heartbeat_at: null,
      updated_at: trx.fn.now(),
    });
}

async function markRequiresRegeneration(
  lease: Lease,
  reason: string
): Promise<void> {
  await withLease(lease, (trx) =>
    requireRegenerationInTrx(trx, lease, `${REVALIDATION_FAILED}:${reason}`)
  );
}

// ─── batch plan ──────────────────────────────────────────────────────────────

interface PlannedBatch {
  batchIndex: number;
  status: string;
  graphqlDocument: string;
  variables: any;
  requestSha256: string;
  requestedApiVersion: string;
  servedApiVersion: string;
}

async function readBatchPlan(lease: Lease): Promise<PlannedBatch[]> {
  return withTenant(lease.shopId, async (trx) => {
    const generation = await trx(GENERATIONS)
      .where({ shop_id: lease.shopId, generation_id: lease.generationId })
      .first('batch_count');

    const rows = await trx(`${GENERATION_BATCHES} as b`)
      .join(`${BATCH_EXECUTIONS} as e`, function () {
        this.on('e.generation_id', '=', 'b.generation_id')
          .andOn('e.batch_index', '=', 'b.batch_index')
          .andOn('e.shop_id', '=', 'b.shop_id');
      })
      .where({
        'b.shop_id': lease.shopId,
        'b.generation_id': lease.generationId,
        'e.execution_id': lease.executionId,
      })
      .orderBy('b.batch_index', 'asc')
      .select(
        'b.batch_index',
        'b.graphql_document',
        'b.canonical_variables',
        'b.idempotency_key',
        'b.request_sha256',
        'b.requested_api_version',
        'b.served_api_version',
        'e.status'
      );

    if (rows.length !== Number(generation?.batch_count)) {
      throw new Error(
        '[OPENING_CUTOVER_EXECUTION_INTERNAL] Batch executions do not cover the immutable generation batches'
      );
    }

    return rows.map((row: any) => {
      const variables = JSON.parse(String(row.canonical_variables));

      // The persisted request is authority; refuse to send anything else.
      if (variables?.idempotencyKey !== row.idempotency_key) {
        throw new Error(
          '[OPENING_CUTOVER_EXECUTION_INTERNAL] Persisted batch variables disagree with its idempotency key'
        );
      }

      return {
        batchIndex: Number(row.batch_index),
        status: String(row.status),
        graphqlDocument: String(row.graphql_document),
        variables,
        requestSha256: String(row.request_sha256),
        requestedApiVersion: String(row.requested_api_version),
        servedApiVersion: String(row.served_api_version),
      };
    });
  });
}

// ─── dispatch ────────────────────────────────────────────────────────────────

/** Short committed transaction: durable dispatch intent BEFORE provider I/O. */
async function beginDispatch(
  lease: Lease,
  batch: PlannedBatch
): Promise<string> {
  return withLease(lease, async (trx) => {
    const [dispatching] = await trx(BATCH_EXECUTIONS)
      .where({
        generation_id: lease.generationId,
        batch_index: batch.batchIndex,
        shop_id: lease.shopId,
        execution_id: lease.executionId,
        status: 'pending',
      })
      .update({
        status: 'dispatching',
        attempt_count: trx.raw('attempt_count + 1'),
        updated_at: trx.fn.now(),
      })
      .returning(['attempt_count']);

    if (!dispatching) {
      throw new Error(
        '[OPENING_CUTOVER_EXECUTION_INTERNAL] Batch is no longer pending'
      );
    }

    const [attempt] = await trx(ATTEMPTS)
      .insert({
        shop_id: lease.shopId,
        execution_id: lease.executionId,
        generation_id: lease.generationId,
        batch_index: batch.batchIndex,
        attempt_number: dispatching.attempt_count,
        dispatch_lease_token: lease.leaseToken,
        request_sha256: batch.requestSha256,
        requested_api_version: batch.requestedApiVersion,
      })
      .returning(['attempt_id']);

    return String(attempt.attempt_id);
  });
}

type AttemptOutcome =
  | 'succeeded'
  | 'user_errors'
  | 'graphql_error'
  | 'http_error'
  | 'throttled'
  | 'no_response'
  | 'aborted';

interface ProviderClassification {
  outcome: AttemptOutcome;
  batchStatus: 'succeeded' | 'rejected' | 'ambiguous';
  httpStatus: number | null;
  xRequestId: string | null;
  servedApiVersion: string | null;
  userErrors: unknown[] | null;
  adjustmentGroupId: string | null;
  errorClass: string | null;
  errorDetail: string | null;
}

function readHeader(headers: unknown, name: string): string | null {
  if (!headers) return null;

  const getter = (headers as any).get;
  if (typeof getter === 'function') {
    const value = String(getter.call(headers, name) ?? '').trim();
    return value || null;
  }

  if (typeof headers !== 'object') return null;

  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== name.toLowerCase()) continue;

    const raw = Array.isArray(value) ? value[0] : value;
    const normalized = String(raw ?? '').trim();
    return normalized || null;
  }

  return null;
}

function detail(value: unknown): string {
  return String(value ?? '').slice(0, ERROR_DETAIL_MAX);
}

function ambiguous(
  outcome: AttemptOutcome,
  errorClass: string,
  fields: Partial<ProviderClassification> = {}
): ProviderClassification {
  return {
    outcome,
    batchStatus: 'ambiguous',
    httpStatus: null,
    xRequestId: null,
    servedApiVersion: null,
    userErrors: null,
    adjustmentGroupId: null,
    errorDetail: null,
    ...fields,
    errorClass,
  };
}

function classifyResponse(
  response: any,
  batch: PlannedBatch
): ProviderClassification {
  const servedApiVersion = servedShopifyApiVersion(response);
  const xRequestId = readHeader(response?.headers, 'x-request-id');
  const metadata = { servedApiVersion, xRequestId };

  const payload = response?.data?.inventorySetQuantities;

  if (!payload || !Array.isArray(payload.userErrors)) {
    return ambiguous('graphql_error', 'SHOPIFY_MUTATION_PAYLOAD_MISSING', metadata);
  }

  // Any mutation userError is a definite provider rejection in E02; no code
  // is classified as stale CAS yet.
  if (payload.userErrors.length > 0) {
    return {
      outcome: 'user_errors',
      batchStatus: 'rejected',
      httpStatus: null,
      ...metadata,
      userErrors: payload.userErrors,
      adjustmentGroupId: null,
      errorClass: 'SHOPIFY_MUTATION_USER_ERRORS',
      errorDetail: null,
    };
  }

  const adjustmentGroupId = payload.inventoryAdjustmentGroup?.id
    ? String(payload.inventoryAdjustmentGroup.id)
    : null;

  if (!adjustmentGroupId) {
    return ambiguous('graphql_error', 'SHOPIFY_ADJUSTMENT_GROUP_MISSING', metadata);
  }

  // The request may have executed under a different contract: never certify.
  if (servedApiVersion !== batch.servedApiVersion) {
    return ambiguous('graphql_error', 'SHOPIFY_SERVED_API_VERSION_MISMATCH', {
      ...metadata,
      adjustmentGroupId,
      errorDetail: `served ${servedApiVersion ?? 'missing'}, frozen ${batch.servedApiVersion}`,
    });
  }

  return {
    outcome: 'succeeded',
    batchStatus: 'succeeded',
    httpStatus: null,
    ...metadata,
    userErrors: null,
    adjustmentGroupId,
    errorClass: null,
    errorDetail: null,
  };
}

/**
 * By SDK error TYPE, never message text. No thrown failure proves the
 * mutation did not execute, so every one is ambiguous.
 */
function classifyThrown(error: unknown): ProviderClassification {
  const message = detail((error as any)?.message ?? error);

  if (error instanceof GraphqlQueryError) {
    const status = (error.response as any)?.status;

    return ambiguous('graphql_error', 'SHOPIFY_GRAPHQL_QUERY_ERROR', {
      httpStatus: Number.isInteger(status) ? status : null,
      xRequestId: readHeader(error.headers, 'x-request-id'),
      servedApiVersion: readHeader(error.headers, 'x-shopify-api-version'),
      errorDetail: message,
    });
  }

  if (error instanceof HttpResponseError) {
    const status = error.response?.code;

    return ambiguous(
      error instanceof HttpThrottlingError ? 'throttled' : 'http_error',
      error instanceof HttpThrottlingError
        ? 'SHOPIFY_HTTP_THROTTLED'
        : 'SHOPIFY_HTTP_ERROR',
      {
        httpStatus: Number.isInteger(status) ? status : null,
        xRequestId: readHeader(error.response?.headers, 'x-request-id'),
        errorDetail: message,
      }
    );
  }

  const name = (error as any)?.name;

  if (name === 'AbortError' || name === 'TimeoutError') {
    return ambiguous('aborted', 'SHOPIFY_REQUEST_ABORTED', {
      errorDetail: message,
    });
  }

  if (error instanceof HttpRequestError) {
    return ambiguous('no_response', 'SHOPIFY_NO_RESPONSE', {
      errorDetail: message,
    });
  }

  return ambiguous('no_response', 'SHOPIFY_UNCLASSIFIED_TRANSPORT_FAILURE', {
    errorDetail: message,
  });
}

/** One short lease-owned transaction per provider result. */
async function finalizeDispatch(
  lease: Lease,
  batch: PlannedBatch,
  attemptId: string,
  classification: ProviderClassification
): Promise<void> {
  await withLease(lease, async (trx) => {
    const finalized = await trx(ATTEMPTS)
      .where({ attempt_id: attemptId, shop_id: lease.shopId })
      .whereNull('finalized_at')
      .update({
        outcome: classification.outcome,
        finalized_at: trx.fn.now(),
        finalized_by_lease_token: lease.leaseToken,
        http_status: classification.httpStatus,
        x_request_id: classification.xRequestId,
        served_api_version: classification.servedApiVersion,
        user_errors: classification.userErrors
          ? trx.raw('?::jsonb', [JSON.stringify(classification.userErrors)])
          : null,
        shopify_adjustment_group_id: classification.adjustmentGroupId,
        error_class: classification.errorClass,
        error_detail: classification.errorDetail,
      });

    if (finalized !== 1) {
      throw new Error(
        '[OPENING_CUTOVER_EXECUTION_INTERNAL] Dispatch attempt is no longer open'
      );
    }

    const succeeded = classification.batchStatus === 'succeeded';

    const updated = await trx(BATCH_EXECUTIONS)
      .where({
        generation_id: lease.generationId,
        batch_index: batch.batchIndex,
        shop_id: lease.shopId,
        execution_id: lease.executionId,
        status: 'dispatching',
      })
      .update({
        status: classification.batchStatus,
        succeeded_at: succeeded ? trx.fn.now() : null,
        shopify_adjustment_group_id: succeeded
          ? classification.adjustmentGroupId
          : null,
        updated_at: trx.fn.now(),
      });

    if (updated !== 1) {
      throw new Error(
        '[OPENING_CUTOVER_EXECUTION_INTERNAL] Batch is no longer dispatching'
      );
    }

    if (classification.batchStatus === 'rejected') {
      await trx(EXECUTIONS)
        .where({ execution_id: lease.executionId, shop_id: lease.shopId })
        .update({
          status: 'blocked',
          blocked_at: trx.fn.now(),
          blocked_reason: PROVIDER_REJECTED,
          lease_token: null,
          lease_expires_at: null,
          lease_heartbeat_at: null,
          updated_at: trx.fn.now(),
        });
    }
  });
}

async function markVerifying(lease: Lease): Promise<void> {
  await withLease(lease, async (trx) => {
    const unfinished = await trx(BATCH_EXECUTIONS)
      .where({ shop_id: lease.shopId, execution_id: lease.executionId })
      .whereNot('status', 'succeeded')
      .first('batch_index');

    if (unfinished) {
      throw new Error(
        '[OPENING_CUTOVER_EXECUTION_INTERNAL] Execution cannot verify with unfinished batches'
      );
    }

    // The live lease is kept: verifying is owned work, not completion.
    await trx(EXECUTIONS)
      .where({ execution_id: lease.executionId, shop_id: lease.shopId })
      .update({ status: 'verifying', updated_at: trx.fn.now() });
  });
}

async function defaultClientFactory(): Promise<OpeningInventoryCutoverShopifyClientFactory> {
  // Loaded lazily: the Shopify SDK validates its configuration at import.
  const { createShopifyGraphQLClient } = await import(
    '../shopify/shopifyClient.service.js'
  );

  return (args) =>
    createShopifyGraphQLClient(args) as unknown as OpeningInventoryCutoverShopifyClient;
}

// ─── executor ────────────────────────────────────────────────────────────────

async function runOwnedExecution(
  lease: Lease,
  deps: ExecuteOpeningInventoryCutoverGenerationDeps
): Promise<OpeningInventoryCutoverExecutionResult> {
  const ids = {
    generationId: lease.generationId,
    executionId: lease.executionId,
  };

  const plan = await readBatchPlan(lease);

  // Zero-write generations still prove current authority before verifying.
  if (plan.length === 0) {
    const authority = await revalidateCurrentAuthority(
      lease.shopId,
      lease.generationId
    );

    if (authority.ok === false) {
      await markRequiresRegeneration(lease, authority.reason);
      return result('requires_regeneration', ids);
    }
  }

  // Strictly sequential: at most one provider mutation in flight.
  for (const batch of plan) {
    if (batch.status === 'succeeded') continue;

    if (batch.status === 'rejected') return result('blocked', ids);

    // ambiguous (or an interrupted dispatch): never resend in E02.
    if (batch.status !== 'pending') return result('ambiguous', ids);

    const authority = await revalidateCurrentAuthority(
      lease.shopId,
      lease.generationId
    );

    if (authority.ok === false) {
      await markRequiresRegeneration(lease, authority.reason);
      return result('requires_regeneration', ids);
    }

    const factory =
      deps.createShopifyGraphQLClient ?? (await defaultClientFactory());

    const client = factory({
      shopId: lease.shopId,
      platformShopName: authority.shopDomain,
      accessToken: decrypt(
        authority.encryptedAccessToken,
        'wms.openingInventoryCutover'
      ),
      apiVersion: batch.requestedApiVersion,
    });

    const attemptId = await beginDispatch(lease, batch);

    // Provider I/O strictly after the dispatch intent committed.
    let classification: ProviderClassification;

    try {
      const response = await client.request(batch.graphqlDocument, {
        variables: batch.variables,
        retries: 0,
      });

      classification = classifyResponse(response, batch);
    } catch (error) {
      classification = classifyThrown(error);
    }

    await finalizeDispatch(lease, batch, attemptId, classification);

    if (classification.batchStatus === 'rejected') {
      return result('blocked', { ...ids, code: PROVIDER_REJECTED });
    }

    if (classification.batchStatus !== 'succeeded') {
      return result('ambiguous', { ...ids, code: classification.errorClass });
    }
  }

  await markVerifying(lease);

  return result('verifying', ids);
}

function resolveLeaseMs(value: number | undefined): number {
  const leaseMs = value ?? OPENING_INVENTORY_CUTOVER_EXECUTION_LEASE_MS;

  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new Error(
      '[OPENING_CUTOVER_EXECUTION] leaseDurationMs must be a positive integer'
    );
  }

  return leaseMs;
}

export async function executeOpeningInventoryCutoverGeneration(
  params: ExecuteOpeningInventoryCutoverGenerationParams,
  deps: ExecuteOpeningInventoryCutoverGenerationDeps = {}
): Promise<OpeningInventoryCutoverExecutionResult> {
  const { shopId, generationId } = params;

  if (typeof generationId !== 'string' || !UUID_PATTERN.test(generationId)) {
    throw new Error('[OPENING_CUTOVER_EXECUTION] generationId must be a UUID');
  }

  const leaseMs = resolveLeaseMs(deps.leaseDurationMs);

  const claim = await claimExecution(shopId, generationId, leaseMs);

  if (claim.kind === 'done') {
    return claim.result;
  }

  try {
    return await runOwnedExecution(claim.lease, deps);
  } catch (error) {
    if (error instanceof OpeningInventoryCutoverStaleClaimError) {
      return result('stale_claim', {
        generationId,
        executionId: claim.lease.executionId,
        code: OPENING_CUTOVER_EXECUTION_STALE_CLAIM,
      });
    }

    throw error;
  }
}

// ─── E03 ambiguity recovery ──────────────────────────────────────────────────

interface FrozenRecoveryEntry {
  itemGid: string;
  targetQuantity: number;
  frozenChangeFrom: number;
  batchPosition: number;
}

interface FrozenRecoveryBatch {
  batchIndex: number;
  batchStatus: string;
  requestedApiVersion: string;
  servedApiVersion: string;
  shopGid: string;
  locationGid: string;
  idempotencyKey: string;
  entryCount: number;
  canonicalVariables: string;
  entries: FrozenRecoveryEntry[];
}

/** First unfinished batch plus its immutable Slice-D request and entries. */
async function readFrozenRecoveryBatch(
  lease: Lease
): Promise<FrozenRecoveryBatch | null> {
  return withTenant(lease.shopId, async (trx) => {
    const unfinished = await trx(BATCH_EXECUTIONS)
      .where({ shop_id: lease.shopId, execution_id: lease.executionId })
      .whereNot('status', 'succeeded')
      .orderBy('batch_index', 'asc')
      .first('batch_index', 'status');

    if (!unfinished) return null;

    const batchIndex = Number(unfinished.batch_index);

    const generation = await trx(GENERATIONS)
      .where({ shop_id: lease.shopId, generation_id: lease.generationId })
      .first(
        'requested_api_version',
        'served_api_version',
        'shopify_shop_gid',
        'shopify_location_gid'
      );

    const batch = await trx(GENERATION_BATCHES)
      .where({
        shop_id: lease.shopId,
        generation_id: lease.generationId,
        batch_index: batchIndex,
      })
      .first('canonical_variables', 'idempotency_key', 'entry_count');

    if (!generation || !batch) {
      throw new Error(
        '[OPENING_CUTOVER_RECOVERY_INTERNAL] Immutable generation batch is missing'
      );
    }

    // Frozen entries are the ONLY recovery comparison authority.
    const entries = await trx(GENERATION_ENTRIES)
      .where({
        shop_id: lease.shopId,
        generation_id: lease.generationId,
        disposition: 'write',
        batch_index: batchIndex,
      })
      .orderBy('batch_position', 'asc')
      .select(
        'shopify_inventory_item_gid',
        'target_quantity',
        'observed_on_hand_quantity',
        'batch_position'
      );

    return {
      batchIndex,
      batchStatus: String(unfinished.status),
      requestedApiVersion: String(generation.requested_api_version),
      servedApiVersion: String(generation.served_api_version),
      shopGid: String(generation.shopify_shop_gid),
      locationGid: String(generation.shopify_location_gid),
      idempotencyKey: String(batch.idempotency_key),
      entryCount: Number(batch.entry_count),
      canonicalVariables: String(batch.canonical_variables),
      entries: entries.map((entry: any) => ({
        itemGid: String(entry.shopify_inventory_item_gid),
        targetQuantity: Number(entry.target_quantity),
        frozenChangeFrom: Number(entry.observed_on_hand_quantity),
        batchPosition: Number(entry.batch_position),
      })),
    };
  });
}

function sameKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();

  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

/**
 * The persisted request must still say exactly what the frozen entries say.
 * Read only: canonical_variables are parsed, never recomputed or rewritten.
 * Returns null when consistent, otherwise a stable mismatch reason.
 */
function frozenRequestIntegrityViolation(
  frozen: FrozenRecoveryBatch
): string | null {
  let variables: any;

  try {
    variables = JSON.parse(frozen.canonicalVariables);
  } catch {
    return 'VARIABLES_UNPARSEABLE';
  }

  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return 'VARIABLES_SHAPE';
  }

  if (!sameKeys(variables, ['idempotencyKey', 'input'])) {
    return 'VARIABLES_SHAPE';
  }

  if (variables.idempotencyKey !== frozen.idempotencyKey) {
    return 'IDEMPOTENCY_KEY';
  }

  const input = variables.input;

  if (
    !input ||
    typeof input !== 'object' ||
    !sameKeys(input, ['name', 'reason', 'referenceDocumentUri', 'quantities']) ||
    input.name !== 'on_hand' ||
    input.reason !== 'correction' ||
    !Array.isArray(input.quantities)
  ) {
    return 'INPUT_SHAPE';
  }

  if (
    frozen.entries.length === 0 ||
    frozen.entries.length !== frozen.entryCount
  ) {
    return 'ENTRY_UNIVERSE';
  }

  const entryByItem = new Map(
    frozen.entries.map((entry) => [entry.itemGid, entry])
  );
  const seen = new Set<string>();

  for (const quantity of input.quantities) {
    if (
      !quantity ||
      typeof quantity !== 'object' ||
      !sameKeys(quantity, [
        'inventoryItemId',
        'locationId',
        'quantity',
        'changeFromQuantity',
      ])
    ) {
      return 'QUANTITY_SHAPE';
    }

    const itemGid = String(quantity.inventoryItemId);

    if (seen.has(itemGid)) return 'DUPLICATE_ITEM';
    seen.add(itemGid);

    const entry = entryByItem.get(itemGid);

    if (!entry) return 'EXTRA_ITEM';

    if (quantity.locationId !== frozen.locationGid) return 'LOCATION';
    if (quantity.quantity !== entry.targetQuantity) return 'TARGET_QUANTITY';
    if (quantity.changeFromQuantity !== entry.frozenChangeFrom) {
      return 'CHANGE_FROM_QUANTITY';
    }
  }

  if (seen.size !== entryByItem.size) return 'MISSING_ITEM';

  return null;
}

/** Short lease-owned transaction committed BEFORE any Shopify read. */
async function beginAmbiguityInspection(
  lease: Lease,
  frozen: FrozenRecoveryBatch
): Promise<string> {
  return withLease(lease, async (trx) => {
    const batch = await trx(BATCH_EXECUTIONS)
      .where({
        shop_id: lease.shopId,
        execution_id: lease.executionId,
        batch_index: frozen.batchIndex,
      })
      .forUpdate()
      .first('status');

    if (batch?.status !== 'ambiguous') {
      throw new Error(
        '[OPENING_CUTOVER_RECOVERY_INTERNAL] Recovery batch is no longer ambiguous'
      );
    }

    const collecting = await trx(VERIFICATIONS)
      .where({
        shop_id: lease.shopId,
        execution_id: lease.executionId,
        batch_index: frozen.batchIndex,
        status: 'collecting',
      })
      .first('verification_id');

    if (collecting) {
      throw new Error(
        '[OPENING_CUTOVER_RECOVERY_INTERNAL] A collecting ambiguity inspection already exists'
      );
    }

    const [verification] = await trx(VERIFICATIONS)
      .insert({
        shop_id: lease.shopId,
        execution_id: lease.executionId,
        generation_id: lease.generationId,
        purpose: 'ambiguity_inspection',
        batch_index: frozen.batchIndex,
        started_by_lease_token: lease.leaseToken,
        status: 'collecting',
        requested_api_version: frozen.requestedApiVersion,
        shop_gid: frozen.shopGid,
        location_gid: frozen.locationGid,
      })
      .returning(['verification_id']);

    return String(verification.verification_id);
  });
}

/** Read-only liveness: never heartbeats, never extends the lease. */
async function assertLeaseLive(
  lease: Lease,
  expectedStatus: LeasedStatus = 'executing'
): Promise<void> {
  const live = await withTenant(lease.shopId, (trx) =>
    trx(EXECUTIONS)
      .where({
        execution_id: lease.executionId,
        shop_id: lease.shopId,
        lease_token: lease.leaseToken,
        status: expectedStatus,
      })
      .whereRaw('lease_expires_at > now()')
      .first('execution_id')
  );

  if (!live) {
    throw new OpeningInventoryCutoverStaleClaimError();
  }
}

/** Collecting header still started by THIS lease; anything else is internal. */
async function closeVerification(
  trx: Knex.Transaction,
  lease: Lease,
  verificationId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const closed = await trx(VERIFICATIONS)
    .where({
      verification_id: verificationId,
      shop_id: lease.shopId,
      status: 'collecting',
      started_by_lease_token: lease.leaseToken,
    })
    .update({
      read_completed_at: trx.fn.now(),
      finalized_by_lease_token: lease.leaseToken,
      ...fields,
    });

  if (closed !== 1) {
    throw new Error(
      '[OPENING_CUTOVER_RECOVERY_INTERNAL] Ambiguity inspection is no longer collecting'
    );
  }
}

/**
 * Failed inspection without lines. `terminalReason` set → deterministic
 * structural failure (requires_regeneration); null → transient/protocol read
 * failure (execution stays executing under the same live lease).
 */
async function failAmbiguityInspection(
  lease: Lease,
  verificationId: string,
  terminalReason: string | null
): Promise<void> {
  await withLease(lease, async (trx) => {
    await closeVerification(trx, lease, verificationId, {
      status: 'failed',
      verdict: null,
    });

    if (terminalReason) {
      await requireRegenerationInTrx(trx, lease, terminalReason);
    }
  });
}

type LineVerdict = 'match' | 'old_state' | 'mismatch' | 'inactive' | 'untracked';
type InspectionVerdict = 'applied' | 'not_applied' | 'mixed';

interface InspectionLine {
  shopify_inventory_item_gid: string;
  observed_on_hand: number | null;
  level_present: boolean;
  active: boolean | null;
  tracked: boolean | null;
  expected_target: number;
  frozen_change_from: number;
  line_verdict: LineVerdict;
}

/**
 * Lines ONLY for frozen batch entries. Malformed eligibility evidence
 * (present with active/tracked NULL) → null: nothing partial is persisted.
 */
function evaluateInspectionLines(
  frozen: FrozenRecoveryBatch,
  collected: OpeningInventoryLocationEvidence
): InspectionLine[] | null {
  const observedByItem = new Map(
    collected.lines.map((line) => [line.shopify_inventory_item_id, line])
  );

  const lines: InspectionLine[] = [];

  for (const entry of frozen.entries) {
    const observed = observedByItem.get(entry.itemGid);
    const base = {
      shopify_inventory_item_gid: entry.itemGid,
      expected_target: entry.targetQuantity,
      frozen_change_from: entry.frozenChangeFrom,
    };

    if (!observed || observed.inventory_level_present !== true) {
      lines.push({
        ...base,
        observed_on_hand: null,
        level_present: false,
        active: null,
        tracked: null,
        line_verdict: 'mismatch',
      });
      continue;
    }

    const evidence = {
      ...base,
      observed_on_hand: observed.on_hand_quantity,
      level_present: true,
      active: observed.inventory_level_active,
      tracked: observed.tracked,
    };

    if (observed.inventory_level_active === false) {
      lines.push({ ...evidence, line_verdict: 'inactive' });
      continue;
    }

    if (observed.tracked === false) {
      lines.push({ ...evidence, line_verdict: 'untracked' });
      continue;
    }

    if (
      observed.inventory_level_active !== true ||
      observed.tracked !== true ||
      !Number.isSafeInteger(observed.on_hand_quantity)
    ) {
      return null;
    }

    lines.push({
      ...evidence,
      line_verdict:
        observed.on_hand_quantity === entry.targetQuantity
          ? 'match'
          : observed.on_hand_quantity === entry.frozenChangeFrom
            ? 'old_state'
            : 'mismatch',
    });
  }

  return lines;
}

function inspectionVerdict(lines: InspectionLine[]): InspectionVerdict {
  if (lines.every((line) => line.line_verdict === 'match')) return 'applied';
  if (lines.every((line) => line.line_verdict === 'old_state')) return 'not_applied';
  return 'mixed';
}

/**
 * One lease-owned transaction: immutable lines, complete header, then either
 * ambiguous → succeeded (applied; no adjustment group is fabricated or copied)
 * or executing → requires_regeneration. not_applied is evidence only.
 */
async function completeAmbiguityInspection(
  lease: Lease,
  frozen: FrozenRecoveryBatch,
  verificationId: string,
  collected: OpeningInventoryLocationEvidence,
  lines: InspectionLine[],
  verdict: InspectionVerdict
): Promise<void> {
  await withLease(lease, async (trx) => {
    await trx(VERIFICATION_LINES).insert(
      lines.map((line) => ({
        ...line,
        verification_id: verificationId,
        shop_id: lease.shopId,
      }))
    );

    await closeVerification(trx, lease, verificationId, {
      status: 'complete',
      verdict,
      served_api_version: collected.servedApiVersion,
      page_count: collected.pageCount,
    });

    if (verdict !== 'applied') {
      await requireRegenerationInTrx(
        trx,
        lease,
        `${OPENING_CUTOVER_RECOVERY_NOT_RECOVERED}:${verdict}`
      );
      return;
    }

    const succeeded = await trx(BATCH_EXECUTIONS)
      .where({
        generation_id: lease.generationId,
        batch_index: frozen.batchIndex,
        shop_id: lease.shopId,
        execution_id: lease.executionId,
        status: 'ambiguous',
      })
      .update({
        status: 'succeeded',
        succeeded_at: trx.fn.now(),
        shopify_adjustment_group_id: null,
        updated_at: trx.fn.now(),
      });

    if (succeeded !== 1) {
      throw new Error(
        '[OPENING_CUTOVER_RECOVERY_INTERNAL] Recovered batch is no longer ambiguous'
      );
    }
  });
}

// Collector failure codes that prove deterministic drift. Every other
// collector failure (transport, GraphQL, malformed page, served version,
// cursor) is a transient/protocol read failure that proves nothing.
const STRUCTURAL_READ_FAILURES = new Set([
  'SHOPIFY_LOCATION_NOT_FOUND',
  'SHOPIFY_LOCATION_MISMATCH',
  'SHOPIFY_LOCATION_INACTIVE',
  'UNMAPPED_SHOPIFY_INVENTORY',
  'SHOPIFY_IDENTITY_AMBIGUOUS',
  'SHOPIFY_IDENTITY_INCOMPLETE',
]);

function collectorFailureCode(error: unknown): string | null {
  const code = (error as any)?.failureCode;
  return typeof code === 'string' && code ? code : null;
}

async function runOwnedRecovery(
  lease: Lease,
  deps: ExecuteOpeningInventoryCutoverGenerationDeps
): Promise<OpeningInventoryCutoverExecutionResult> {
  const ids = {
    generationId: lease.generationId,
    executionId: lease.executionId,
  };

  const frozen = await readFrozenRecoveryBatch(lease);

  if (!frozen || frozen.batchStatus !== 'ambiguous') {
    return result('not_ambiguous', {
      ...ids,
      code: OPENING_CUTOVER_RECOVERY_NOT_AMBIGUOUS,
    });
  }

  // Inconsistent durable request authority: nothing trustworthy to compare.
  const violation = frozenRequestIntegrityViolation(frozen);

  if (violation) {
    await withLease(lease, (trx) =>
      requireRegenerationInTrx(
        trx,
        lease,
        `${OPENING_CUTOVER_RECOVERY_FROZEN_REQUEST_INTEGRITY}:${violation}`
      )
    );

    return result('requires_regeneration', {
      ...ids,
      code: OPENING_CUTOVER_RECOVERY_FROZEN_REQUEST_INTEGRITY,
    });
  }

  const installation = await withTenant(lease.shopId, (trx) =>
    trx('shopify_app_installations')
      .where({ shop_id: lease.shopId })
      .whereNull('uninstalled_at')
      .first('shop_domain', 'access_token')
  );

  if (!installation?.shop_domain || !installation?.access_token) {
    await withLease(lease, (trx) =>
      requireRegenerationInTrx(trx, lease, RECOVERY_INSTALLATION_MISSING)
    );

    return result('requires_regeneration', {
      ...ids,
      code: RECOVERY_INSTALLATION_MISSING,
    });
  }

  const verificationId = await beginAmbiguityInspection(lease, frozen);

  const structural = async (code: string) => {
    await failAmbiguityInspection(
      lease,
      verificationId,
      `${OPENING_CUTOVER_RECOVERY_STRUCTURAL_DRIFT}:${code}`
    );

    return result('requires_regeneration', {
      ...ids,
      code: OPENING_CUTOVER_RECOVERY_STRUCTURAL_DRIFT,
    });
  };

  const transient = async (code: string) => {
    await failAmbiguityInspection(lease, verificationId, null);

    return result('ambiguous', {
      ...ids,
      code: `${OPENING_CUTOVER_RECOVERY_READ_FAILED}:${code}`,
    });
  };

  // Current identity is collector CONTEXT only (mapped extras); frozen
  // entries alone define what is judged.
  let identities: Map<string, ShopifyItemIdentity>;

  try {
    identities = await withTenant(lease.shopId, async (trx) =>
      buildShopifyItemIdentities(await selectShopifyIdentityRows(trx, lease.shopId))
    );
  } catch (error) {
    const code = collectorFailureCode(error);
    if (code && STRUCTURAL_READ_FAILURES.has(code)) return structural(code);
    throw error;
  }

  const factory =
    deps.createShopifyGraphQLClient ?? (await defaultClientFactory());

  const client = factory({
    shopId: lease.shopId,
    platformShopName: String(installation.shop_domain),
    accessToken: decrypt(
      installation.access_token,
      'wms.openingInventoryCutover'
    ),
    // Frozen authority, never the process-global current version.
    apiVersion: frozen.requestedApiVersion,
  });

  // No transaction is open while Shopify is awaited.
  let collected: OpeningInventoryLocationEvidence;

  try {
    collected = await collectOpeningInventoryLocationEvidence({
      shopId: lease.shopId,
      locationGid: frozen.locationGid,
      identities,
      readLocationPage: ({ variables }) =>
        client.request(OPENING_INVENTORY_SNAPSHOT_QUERY, {
          variables,
          retries: 0,
        }),
      requireServedApiVersion: true,
      onPage: () => assertLeaseLive(lease),
    });
  } catch (error) {
    if (error instanceof OpeningInventoryCutoverStaleClaimError) throw error;

    const code = collectorFailureCode(error);
    if (!code) throw error;

    return STRUCTURAL_READ_FAILURES.has(code) ? structural(code) : transient(code);
  }

  if (collected.servedApiVersion !== frozen.servedApiVersion) {
    return transient('SHOPIFY_SERVED_API_VERSION_MISMATCH');
  }

  const lines = evaluateInspectionLines(frozen, collected);

  if (!lines) {
    return structural('MALFORMED_ELIGIBILITY_EVIDENCE');
  }

  const verdict = inspectionVerdict(lines);

  await completeAmbiguityInspection(
    lease,
    frozen,
    verificationId,
    collected,
    lines,
    verdict
  );

  if (verdict !== 'applied') {
    return result('requires_regeneration', {
      ...ids,
      code: `${OPENING_CUTOVER_RECOVERY_NOT_RECOVERED}:${verdict}`,
    });
  }

  // Same lease, normal E02 rules: revalidate, durable attempt, dispatch the
  // next pending batch exactly once, or verifying when all succeeded.
  return runOwnedExecution(lease, deps);
}

/**
 * E03: read-only Shopify readback for the first unfinished batch when it is
 * ambiguous. Never resends; never converges; never writes the completion
 * marker; never mutates Slice-D rows.
 */
export async function recoverOpeningInventoryCutoverAmbiguity(
  params: ExecuteOpeningInventoryCutoverGenerationParams,
  deps: ExecuteOpeningInventoryCutoverGenerationDeps = {}
): Promise<OpeningInventoryCutoverExecutionResult> {
  const { shopId, generationId } = params;

  if (typeof generationId !== 'string' || !UUID_PATTERN.test(generationId)) {
    throw new Error('[OPENING_CUTOVER_RECOVERY] generationId must be a UUID');
  }

  const leaseMs = resolveLeaseMs(deps.leaseDurationMs);

  const claim = await claimExecution(shopId, generationId, leaseMs, 'recover');

  if (claim.kind === 'done') {
    return claim.result;
  }

  try {
    return await runOwnedRecovery(claim.lease, deps);
  } catch (error) {
    if (error instanceof OpeningInventoryCutoverStaleClaimError) {
      return result('stale_claim', {
        generationId,
        executionId: claim.lease.executionId,
        code: OPENING_CUTOVER_EXECUTION_STALE_CLAIM,
      });
    }

    throw error;
  }
}

// ─── E04 final convergence ───────────────────────────────────────────────────

type FrozenDisposition = 'write' | 'no_op' | 'provider_only_zero';

interface FrozenConvergenceEntry {
  itemGid: string;
  variantGid: string | null;
  lasyncroVariantId: string | null;
  disposition: FrozenDisposition;
  targetQuantity: number | null;
  observedOnHand: number;
}

/** Immutable Slice-D authority: the generation header and ALL its entries. */
interface FrozenConvergenceAuthority {
  requestedApiVersion: string;
  servedApiVersion: string;
  shopGid: string;
  locationGid: string;
  snapshotId: string;
  warehouseId: string;
  targetFingerprint: string;
  identityFingerprint: string;
  entries: FrozenConvergenceEntry[];
}

async function readFrozenConvergenceAuthority(
  lease: Lease
): Promise<FrozenConvergenceAuthority> {
  return withTenant(lease.shopId, async (trx) => {
    const generation = await trx(GENERATIONS)
      .where({ shop_id: lease.shopId, generation_id: lease.generationId })
      .first(
        'requested_api_version',
        'served_api_version',
        'shopify_shop_gid',
        'shopify_location_gid',
        'opening_snapshot_id',
        'warehouse_id',
        'target_fingerprint',
        'identity_fingerprint'
      );

    if (!generation) {
      throw new Error(
        '[OPENING_CUTOVER_CONVERGENCE_INTERNAL] Immutable generation is missing'
      );
    }

    // write + no_op + provider_only_zero: every frozen entry is authority.
    const entries = await trx(GENERATION_ENTRIES)
      .where({ shop_id: lease.shopId, generation_id: lease.generationId })
      .orderBy('ordinal', 'asc')
      .select(
        'shopify_inventory_item_gid',
        'shopify_variant_gid',
        'lasyncro_variant_id',
        'disposition',
        'target_quantity',
        'observed_on_hand_quantity'
      );

    return {
      requestedApiVersion: String(generation.requested_api_version),
      servedApiVersion: String(generation.served_api_version),
      shopGid: String(generation.shopify_shop_gid),
      locationGid: String(generation.shopify_location_gid),
      snapshotId: String(generation.opening_snapshot_id),
      warehouseId: String(generation.warehouse_id),
      targetFingerprint: String(generation.target_fingerprint),
      identityFingerprint: String(generation.identity_fingerprint),
      entries: entries.map((entry: any) => ({
        itemGid: String(entry.shopify_inventory_item_gid),
        variantGid: entry.shopify_variant_gid ? String(entry.shopify_variant_gid) : null,
        lasyncroVariantId: entry.lasyncro_variant_id
          ? String(entry.lasyncro_variant_id)
          : null,
        disposition: entry.disposition as FrozenDisposition,
        targetQuantity:
          entry.target_quantity === null ? null : Number(entry.target_quantity),
        observedOnHand: Number(entry.observed_on_hand_quantity),
      })),
    };
  });
}

/** Independent proof that a capture still IS the frozen generation authority. */
function frozenAuthorityViolation(
  captured: CapturedAuthority,
  frozen: FrozenConvergenceAuthority
): string | null {
  if (captured.readinessPassed !== true) return 'READINESS';
  if (captured.shopGid !== frozen.shopGid) return 'SHOP_GID';
  if (captured.snapshotId !== frozen.snapshotId) return 'SNAPSHOT';
  if (captured.warehouseId !== frozen.warehouseId) return 'WAREHOUSE';
  if (captured.locationGid !== frozen.locationGid) return 'LOCATION';
  if (captured.targetFingerprint !== frozen.targetFingerprint) return 'TARGET';
  if (captured.identityFingerprint !== frozen.identityFingerprint) return 'IDENTITY';
  return null;
}

/** V1 == V2 over all material authority, canonical rows included. */
function authorityDifference(
  v1: CapturedAuthority,
  v2: CapturedAuthority
): string | null {
  if (v1.shopGid !== v2.shopGid) return 'SHOP_GID';
  if (v1.shopDomain !== v2.shopDomain) return 'SHOP_DOMAIN';
  if (v1.snapshotId !== v2.snapshotId) return 'SNAPSHOT';
  if (v1.warehouseId !== v2.warehouseId) return 'WAREHOUSE';
  if (v1.locationGid !== v2.locationGid) return 'LOCATION';
  if (v1.readinessPassed !== v2.readinessPassed) return 'READINESS';
  if (v1.targetFingerprint !== v2.targetFingerprint) return 'TARGET';
  if (v1.identityFingerprint !== v2.identityFingerprint) return 'IDENTITY';

  if (JSON.stringify(v1.targetRows) !== JSON.stringify(v2.targetRows)) {
    return 'TARGET_ROWS';
  }

  if (JSON.stringify(v1.identityRows) !== JSON.stringify(v2.identityRows)) {
    return 'IDENTITY_ROWS';
  }

  return null;
}

/** Inside a lease-owned transaction: verifying → blocked, marker untouched. */
async function blockForLegacyMarkerInTrx(
  trx: Knex.Transaction,
  lease: Lease
): Promise<void> {
  const blocked = await trx(EXECUTIONS)
    .where({
      execution_id: lease.executionId,
      shop_id: lease.shopId,
      status: 'verifying',
      lease_token: lease.leaseToken,
    })
    .update({
      status: 'blocked',
      blocked_at: trx.fn.now(),
      blocked_reason: OPENING_CUTOVER_LEGACY_COMPLETION_MARKER_PRESENT,
      lease_token: null,
      lease_expires_at: null,
      lease_heartbeat_at: null,
      updated_at: trx.fn.now(),
    });

  if (blocked !== 1) {
    throw new Error(
      '[OPENING_CUTOVER_CONVERGENCE_INTERNAL] Verifying execution could not be blocked'
    );
  }
}

async function legacyMarkerPresent(
  trx: Knex.Transaction,
  shopId: number
): Promise<boolean> {
  const settings = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .first('opening_inventory_shopify_synced_at');

  return (
    settings?.opening_inventory_shopify_synced_at !== null &&
    settings?.opening_inventory_shopify_synced_at !== undefined
  );
}

type FinalConvergenceStart =
  | { kind: 'blocked' }
  | { kind: 'started'; verificationId: string };

/**
 * Short lease-owned transaction committed BEFORE any Shopify read: legacy
 * completion-marker conflict check, then exactly one collecting header.
 */
async function beginFinalConvergence(
  lease: Lease,
  frozen: FrozenConvergenceAuthority
): Promise<FinalConvergenceStart> {
  return withLease(
    lease,
    async (trx) => {
      if (await legacyMarkerPresent(trx, lease.shopId)) {
        await blockForLegacyMarkerInTrx(trx, lease);
        return { kind: 'blocked' as const };
      }

      const collecting = await trx(VERIFICATIONS)
        .where({
          shop_id: lease.shopId,
          execution_id: lease.executionId,
          purpose: 'final_convergence',
          status: 'collecting',
        })
        .first('verification_id');

      if (collecting) {
        throw new Error(
          '[OPENING_CUTOVER_CONVERGENCE_INTERNAL] A collecting final verification already exists'
        );
      }

      const [verification] = await trx(VERIFICATIONS)
        .insert({
          shop_id: lease.shopId,
          execution_id: lease.executionId,
          generation_id: lease.generationId,
          purpose: 'final_convergence',
          batch_index: null,
          started_by_lease_token: lease.leaseToken,
          status: 'collecting',
          requested_api_version: frozen.requestedApiVersion,
          shop_gid: frozen.shopGid,
          location_gid: frozen.locationGid,
        })
        .returning(['verification_id']);

      return {
        kind: 'started' as const,
        verificationId: String(verification.verification_id),
      };
    },
    'verifying'
  );
}

/**
 * Failed final verification without lines. `terminalReason` set →
 * deterministic drift (requires_regeneration); null → transient/protocol read
 * failure (execution stays verifying under the same live lease).
 */
async function failFinalVerification(
  lease: Lease,
  verificationId: string,
  terminalReason: string | null
): Promise<void> {
  await withLease(
    lease,
    async (trx) => {
      await closeVerification(trx, lease, verificationId, {
        status: 'failed',
        verdict: null,
      });

      if (terminalReason) {
        await requireRegenerationInTrx(trx, lease, terminalReason);
      }
    },
    'verifying'
  );
}

type FinalLineVerdict = 'match' | 'mismatch' | 'inactive' | 'untracked' | 'unknown_item';

interface FinalLine {
  shopify_inventory_item_gid: string;
  observed_on_hand: number | null;
  level_present: boolean;
  active: boolean | null;
  tracked: boolean | null;
  expected_target: number | null;
  frozen_change_from: number | null;
  line_verdict: FinalLineVerdict;
}

type FinalEvaluation =
  | { ok: true; lines: FinalLine[] }
  | { ok: false; reason: string };

function sameVariantGid(left: string, right: string): boolean {
  return left.trim() === right.trim();
}

/**
 * Final comparison universe = V2 physical target ∪ ALL frozen entries ∪
 * PRESENT provider items. Any deterministic structural problem returns a
 * reason and no lines: nothing partial is ever persisted.
 */
function evaluateFinalLines(
  frozen: FrozenConvergenceAuthority,
  v2: CapturedAuthority,
  collected: OpeningInventoryLocationEvidence
): FinalEvaluation {
  let identities: Map<string, ShopifyItemIdentity>;

  try {
    identities = buildShopifyItemIdentities(v2.identityRows);
  } catch (error) {
    const code = collectorFailureCode(error);
    if (code) return { ok: false, reason: code };
    throw error;
  }

  const itemByVariant = new Map<string, string>();
  for (const [itemGid, identity] of identities) {
    itemByVariant.set(identity.lasyncroVariantId, itemGid);
  }

  const entryByItem = new Map(frozen.entries.map((entry) => [entry.itemGid, entry]));

  // Current-only target item: frozen/local authority drift, never a
  // provider mismatch.
  const targetItems = new Set<string>();

  for (const row of v2.targetRows) {
    const itemGid = itemByVariant.get(row.lasyncroVariantId);
    const entry = itemGid ? entryByItem.get(itemGid) : undefined;

    if (
      !itemGid ||
      !entry ||
      entry.disposition === 'provider_only_zero' ||
      entry.lasyncroVariantId !== row.lasyncroVariantId ||
      entry.targetQuantity !== row.targetQuantity
    ) {
      return { ok: false, reason: 'CURRENT_TARGET_NOT_FROZEN' };
    }

    targetItems.add(itemGid);
  }

  // Frozen write/no_op item outside current target: drift. Frozen
  // provider_only_zero legitimately sits outside the physical target.
  for (const entry of frozen.entries) {
    if (entry.disposition !== 'provider_only_zero' && !targetItems.has(entry.itemGid)) {
      return { ok: false, reason: 'FROZEN_TARGET_NOT_CURRENT' };
    }
  }

  const observedByItem = new Map<string, SnapshotLine>();

  for (const line of collected.lines) {
    if (line.inventory_level_present !== true) continue;

    // Provider ProductVariant must agree with the canonical mapped identity,
    // even when the quantity matches. A null provider variant is absence.
    const identity = identities.get(line.shopify_inventory_item_id);
    const mappedVariant =
      identity?.externalVariantId ??
      entryByItem.get(line.shopify_inventory_item_id)?.variantGid ??
      null;

    if (
      mappedVariant &&
      line.shopify_variant_id !== null &&
      !sameVariantGid(String(line.shopify_variant_id), mappedVariant)
    ) {
      return { ok: false, reason: 'PROVIDER_VARIANT_MISMATCH' };
    }

    observedByItem.set(line.shopify_inventory_item_id, line);
  }

  const lines: FinalLine[] = [];

  for (const entry of frozen.entries) {
    const observed = observedByItem.get(entry.itemGid);
    const zeroExpected = entry.disposition === 'provider_only_zero';

    const base = {
      shopify_inventory_item_gid: entry.itemGid,
      expected_target: zeroExpected ? 0 : Number(entry.targetQuantity),
      frozen_change_from: entry.observedOnHand,
    };

    if (!observed) {
      lines.push({
        ...base,
        observed_on_hand: null,
        level_present: false,
        active: null,
        tracked: null,
        // A known zero item without a Location level holds zero.
        line_verdict: zeroExpected ? 'match' : 'mismatch',
      });
      continue;
    }

    const evidence = {
      ...base,
      observed_on_hand: observed.on_hand_quantity,
      level_present: true,
      active: observed.inventory_level_active,
      tracked: observed.tracked,
    };

    if (zeroExpected) {
      if (
        observed.inventory_level_active !== true ||
        observed.tracked !== true ||
        !Number.isSafeInteger(observed.on_hand_quantity)
      ) {
        return { ok: false, reason: 'PROVIDER_ONLY_ZERO_INELIGIBLE' };
      }

      lines.push({
        ...evidence,
        line_verdict: observed.on_hand_quantity === 0 ? 'match' : 'mismatch',
      });
      continue;
    }

    if (observed.inventory_level_active === false) {
      lines.push({ ...evidence, line_verdict: 'inactive' });
      continue;
    }

    if (observed.tracked === false) {
      lines.push({ ...evidence, line_verdict: 'untracked' });
      continue;
    }

    if (
      observed.inventory_level_active !== true ||
      observed.tracked !== true ||
      !Number.isSafeInteger(observed.on_hand_quantity)
    ) {
      return { ok: false, reason: 'MALFORMED_ELIGIBILITY_EVIDENCE' };
    }

    // Never old_state: anything but the frozen target is a mismatch.
    lines.push({
      ...evidence,
      line_verdict:
        observed.on_hand_quantity === base.expected_target ? 'match' : 'mismatch',
    });
  }

  // PRESENT provider items outside frozen ∪ current never disappear; zero
  // does not establish trusted identity.
  for (const [itemGid, observed] of observedByItem) {
    if (entryByItem.has(itemGid) || targetItems.has(itemGid)) continue;

    lines.push({
      shopify_inventory_item_gid: itemGid,
      observed_on_hand: observed.on_hand_quantity,
      level_present: true,
      active: observed.inventory_level_active,
      tracked: observed.tracked,
      expected_target: null,
      frozen_change_from: null,
      line_verdict: 'unknown_item',
    });
  }

  lines.sort((left, right) =>
    left.shopify_inventory_item_gid < right.shopify_inventory_item_gid
      ? -1
      : left.shopify_inventory_item_gid > right.shopify_inventory_item_gid
        ? 1
        : 0
  );

  return { ok: true, lines };
}

/**
 * THE final transaction: ONE REPEATABLE READ transaction whose snapshot is
 * taken by withTenant's set_config BEFORE the verifying-lease CAS row-locks
 * the execution; V2 is captured under that lock, compared to the frozen
 * authority and V1, and the verdict (lines, header, execution, completion
 * marker) commits atomically. All timestamps are this transaction's now().
 */
async function finalizeConvergence(
  lease: Lease,
  frozen: FrozenConvergenceAuthority,
  verificationId: string,
  v1: CapturedAuthority,
  collected: OpeningInventoryLocationEvidence
): Promise<OpeningInventoryCutoverExecutionResult> {
  const ids = { generationId: lease.generationId, executionId: lease.executionId };

  return withTenant(
    lease.shopId,
    async (trx) => {
      await casLease(trx, lease, 'verifying');

      const header = await trx(VERIFICATIONS)
        .where({
          verification_id: verificationId,
          shop_id: lease.shopId,
          purpose: 'final_convergence',
          status: 'collecting',
          started_by_lease_token: lease.leaseToken,
        })
        .first('verification_id');

      if (!header) {
        throw new Error(
          '[OPENING_CUTOVER_CONVERGENCE_INTERNAL] Final verification is no longer collecting'
        );
      }

      const fail = async (code: string, reason: string) => {
        await closeVerification(trx, lease, verificationId, {
          status: 'failed',
          verdict: null,
        });
        await requireRegenerationInTrx(trx, lease, `${code}:${reason}`);

        return result('requires_regeneration', { ...ids, code });
      };

      const v2 = await captureCurrentAuthorityInTrx(
        trx,
        lease.shopId,
        lease.generationId
      );

      if (v2.ok === false) {
        return fail(OPENING_CUTOVER_FINAL_LOCAL_DRIFT, `V2:${v2.reason}`);
      }

      const frozenViolation = frozenAuthorityViolation(v2.authority, frozen);

      if (frozenViolation) {
        return fail(OPENING_CUTOVER_FINAL_LOCAL_DRIFT, `V2_FROZEN:${frozenViolation}`);
      }

      const difference = authorityDifference(v1, v2.authority);

      if (difference) {
        return fail(OPENING_CUTOVER_FINAL_LOCAL_DRIFT, `V1_V2:${difference}`);
      }

      // A completion marker that appeared during the read: never converge.
      if (await legacyMarkerPresent(trx, lease.shopId)) {
        await closeVerification(trx, lease, verificationId, {
          status: 'failed',
          verdict: null,
        });
        await blockForLegacyMarkerInTrx(trx, lease);

        return result('blocked', {
          ...ids,
          code: OPENING_CUTOVER_LEGACY_COMPLETION_MARKER_PRESENT,
        });
      }

      const evaluation = evaluateFinalLines(frozen, v2.authority, collected);

      if (evaluation.ok === false) {
        return fail(OPENING_CUTOVER_FINAL_STRUCTURAL_DRIFT, evaluation.reason);
      }

      const { lines } = evaluation;

      if (lines.length > 0) {
        await trx(VERIFICATION_LINES).insert(
          lines.map((line) => ({
            ...line,
            verification_id: verificationId,
            shop_id: lease.shopId,
          }))
        );
      }

      const converged = lines.every((line) => line.line_verdict === 'match');

      await closeVerification(trx, lease, verificationId, {
        status: 'complete',
        verdict: converged ? 'converged' : 'not_converged',
        readiness_passed: true,
        target_fingerprint: v2.authority.targetFingerprint,
        identity_fingerprint: v2.authority.identityFingerprint,
        served_api_version: collected.servedApiVersion,
        page_count: collected.pageCount,
      });

      if (!converged) {
        const counts = lines.reduce<Record<string, number>>((acc, line) => {
          acc[line.line_verdict] = (acc[line.line_verdict] ?? 0) + 1;
          return acc;
        }, {});

        await requireRegenerationInTrx(
          trx,
          lease,
          `${OPENING_CUTOVER_FINAL_NOT_CONVERGED}:${Object.keys(counts)
            .sort()
            .map((verdict) => `${verdict}=${counts[verdict]}`)
            .join(',')}`
        );

        return result('requires_regeneration', {
          ...ids,
          code: OPENING_CUTOVER_FINAL_NOT_CONVERGED,
        });
      }

      const completed = await trx(EXECUTIONS)
        .where({
          execution_id: lease.executionId,
          shop_id: lease.shopId,
          status: 'verifying',
          lease_token: lease.leaseToken,
        })
        .update({
          status: 'converged',
          terminal_at: trx.fn.now(),
          terminal_reason: OPENING_CUTOVER_CONVERGED,
          blocked_at: null,
          blocked_reason: null,
          lease_token: null,
          lease_expires_at: null,
          lease_heartbeat_at: null,
          updated_at: trx.fn.now(),
        });

      if (completed !== 1) {
        throw new Error(
          '[OPENING_CUTOVER_CONVERGENCE_INTERNAL] Verifying execution could not converge'
        );
      }

      // Guarded NULL → now(): the only Slice-E completion-marker write.
      const marked = await trx('shop_wms_settings')
        .where({ shop_id: lease.shopId })
        .whereNull('opening_inventory_shopify_synced_at')
        .update({ opening_inventory_shopify_synced_at: trx.fn.now() });

      if (marked !== 1) {
        throw new Error(
          '[OPENING_CUTOVER_CONVERGENCE_INTERNAL] Completion marker could not be written'
        );
      }

      return result('converged', { ...ids, code: OPENING_CUTOVER_CONVERGED });
    },
    { isolationLevel: 'repeatable read' }
  );
}

function isSerializationFailure(error: unknown): boolean {
  return (error as any)?.code === PG_SERIALIZATION_FAILURE;
}

async function runOwnedConvergence(
  lease: Lease,
  deps: ExecuteOpeningInventoryCutoverGenerationDeps
): Promise<OpeningInventoryCutoverExecutionResult> {
  const ids = { generationId: lease.generationId, executionId: lease.executionId };

  const frozen = await readFrozenConvergenceAuthority(lease);

  const started = await beginFinalConvergence(lease, frozen);

  if (started.kind === 'blocked') {
    return result('blocked', {
      ...ids,
      code: OPENING_CUTOVER_LEGACY_COMPLETION_MARKER_PRESENT,
    });
  }

  const { verificationId } = started;

  const structural = async (code: string, reason: string) => {
    await failFinalVerification(lease, verificationId, `${code}:${reason}`);
    return result('requires_regeneration', { ...ids, code });
  };

  const transient = async (reason: string) => {
    await failFinalVerification(lease, verificationId, null);
    return result('verifying', {
      ...ids,
      code: `${OPENING_CUTOVER_FINAL_READ_FAILED}:${reason}`,
    });
  };

  // V1: committed header first, then a separate READ ONLY RR capture held in
  // memory only.
  const captured = await withTenant(
    lease.shopId,
    (trx) => captureCurrentAuthorityInTrx(trx, lease.shopId, lease.generationId),
    { isolationLevel: 'repeatable read', readOnly: true }
  );

  if (captured.ok === false) {
    return structural(OPENING_CUTOVER_FINAL_LOCAL_DRIFT, `V1:${captured.reason}`);
  }

  const v1 = captured.authority;
  const frozenViolation = frozenAuthorityViolation(v1, frozen);

  if (frozenViolation) {
    return structural(OPENING_CUTOVER_FINAL_LOCAL_DRIFT, `V1_FROZEN:${frozenViolation}`);
  }

  // V1 identity is collector CONTEXT; frozen entries remain comparison
  // authority.
  let identities: Map<string, ShopifyItemIdentity>;

  try {
    identities = buildShopifyItemIdentities(v1.identityRows);
  } catch (error) {
    const code = collectorFailureCode(error);
    if (code && STRUCTURAL_READ_FAILURES.has(code)) {
      return structural(OPENING_CUTOVER_FINAL_STRUCTURAL_DRIFT, code);
    }
    throw error;
  }

  const factory = deps.createShopifyGraphQLClient ?? (await defaultClientFactory());

  const client = factory({
    shopId: lease.shopId,
    platformShopName: v1.shopDomain,
    accessToken: decrypt(v1.encryptedAccessToken, 'wms.openingInventoryCutover'),
    // Frozen authority, never the process-global current version.
    apiVersion: frozen.requestedApiVersion,
  });

  // No transaction is open while Shopify is awaited.
  let collected: OpeningInventoryLocationEvidence;

  try {
    collected = await collectOpeningInventoryLocationEvidence({
      shopId: lease.shopId,
      locationGid: frozen.locationGid,
      identities,
      readLocationPage: ({ variables }) =>
        client.request(OPENING_INVENTORY_SNAPSHOT_QUERY, {
          variables,
          retries: 0,
        }),
      requireServedApiVersion: true,
      onPage: () => assertLeaseLive(lease, 'verifying'),
    });
  } catch (error) {
    if (error instanceof OpeningInventoryCutoverStaleClaimError) throw error;

    const code = collectorFailureCode(error);
    if (!code) throw error;

    return STRUCTURAL_READ_FAILURES.has(code)
      ? structural(OPENING_CUTOVER_FINAL_STRUCTURAL_DRIFT, code)
      : transient(code);
  }

  if (collected.servedApiVersion !== frozen.servedApiVersion) {
    return transient('SHOPIFY_SERVED_API_VERSION_MISMATCH');
  }

  try {
    return await finalizeConvergence(lease, frozen, verificationId, v1, collected);
  } catch (error) {
    // The aborted final transaction is already rolled back: nothing it wrote
    // survives, and nothing more is written here. Fail closed, retryable.
    if (isSerializationFailure(error)) {
      console.warn(`[${OPENING_CUTOVER_FINAL_SERIALIZATION_CONFLICT}]`, {
        shopId: lease.shopId,
        generationId: lease.generationId,
        executionId: lease.executionId,
        sqlstate: PG_SERIALIZATION_FAILURE,
      });

      return result('stale_claim', {
        ...ids,
        code: OPENING_CUTOVER_FINAL_SERIALIZATION_CONFLICT,
      });
    }

    throw error;
  }
}

/**
 * E04: READ-ONLY final certification of a verifying execution. Never
 * mutates Shopify, never mutates Slice-D rows, never generates N+1. The
 * completion marker is written only together with a converged execution.
 */
export async function verifyOpeningInventoryCutoverConvergence(
  params: ExecuteOpeningInventoryCutoverGenerationParams,
  deps: ExecuteOpeningInventoryCutoverGenerationDeps = {}
): Promise<OpeningInventoryCutoverExecutionResult> {
  const { shopId, generationId } = params;

  if (typeof generationId !== 'string' || !UUID_PATTERN.test(generationId)) {
    throw new Error('[OPENING_CUTOVER_CONVERGENCE] generationId must be a UUID');
  }

  const leaseMs = resolveLeaseMs(deps.leaseDurationMs);

  const claim = await claimExecution(shopId, generationId, leaseMs, 'converge');

  if (claim.kind === 'done') {
    return claim.result;
  }

  try {
    return await runOwnedConvergence(claim.lease, deps);
  } catch (error) {
    if (error instanceof OpeningInventoryCutoverStaleClaimError) {
      return result('stale_claim', {
        generationId,
        executionId: claim.lease.executionId,
        code: OPENING_CUTOVER_EXECUTION_STALE_CLAIM,
      });
    }

    throw error;
  }
}
