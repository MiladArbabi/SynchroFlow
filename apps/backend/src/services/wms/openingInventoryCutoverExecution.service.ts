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
// Out of scope (later Slice E): ambiguity readback/recovery, final
// convergence, verification rows, opening_inventory_shopify_synced_at, N+1
// regeneration. E02 never converges and never mutates Slice-D rows.

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
} from './openingInventoryPhysicalTarget.service.js';
import {
  identityFingerprint,
  normalizeShopifyGid,
  selectShopifyIdentityRows,
  servedShopifyApiVersion,
} from './shopifyOpeningInventorySnapshot.service.js';

const GENERATIONS = 'opening_inventory_cutover_generations';
const GENERATION_BATCHES = 'opening_inventory_cutover_generation_batches';
const EXECUTIONS = 'opening_inventory_cutover_executions';
const BATCH_EXECUTIONS = 'opening_inventory_cutover_batch_executions';
const ATTEMPTS = 'opening_inventory_cutover_batch_attempts';

/** Conservative default; no heartbeat in E02. */
export const OPENING_INVENTORY_CUTOVER_EXECUTION_LEASE_MS = 5 * 60 * 1000;

export const OPENING_CUTOVER_EXECUTION_BUSY = 'OPENING_CUTOVER_EXECUTION_BUSY';
export const OPENING_CUTOVER_EXECUTION_STALE_CLAIM =
  'OPENING_CUTOVER_EXECUTION_STALE_CLAIM';

const REVALIDATION_FAILED = 'OPENING_CUTOVER_EXECUTION_REVALIDATION_FAILED';
const PROVIDER_REJECTED = 'OPENING_CUTOVER_EXECUTION_PROVIDER_REJECTED';
const LEASE_RECLAIMED = 'OPENING_CUTOVER_EXECUTION_LEASE_RECLAIMED';

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
  | 'stale_claim';

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

/**
 * Lease CAS: every authoritative executor transaction starts here. The row
 * lock it takes serializes against a concurrent reclaim; zero rows = stale.
 */
async function withLease<T>(
  lease: Lease,
  fn: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return withTenant(lease.shopId, async (trx) => {
    const owned = await trx(EXECUTIONS)
      .where({
        execution_id: lease.executionId,
        shop_id: lease.shopId,
        lease_token: lease.leaseToken,
        status: 'executing',
      })
      .whereRaw('lease_expires_at > now()')
      .update({ updated_at: trx.fn.now() })
      .returning('execution_id');

    if (owned.length !== 1) {
      throw new OpeningInventoryCutoverStaleClaimError();
    }

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

async function claimExecution(
  shopId: number,
  generationId: string,
  leaseMs: number
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

    if (existing.status !== 'executing') {
      return {
        kind: 'done' as const,
        result: result(existing.status, { generationId, executionId }),
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

    // Expired lease: issue a NEW token; the old token loses authority now.
    const [reclaimed] = await trx(EXECUTIONS)
      .where({
        execution_id: executionId,
        shop_id: shopId,
        status: 'executing',
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

function drift(reason: string): Authority {
  return { ok: false, reason };
}

/**
 * One REPEATABLE READ snapshot (taken by withTenant's set_config) for every
 * authority read. Read only. Authority errors become drift; anything else
 * propagates.
 */
async function revalidateCurrentAuthority(
  shopId: number,
  generationId: string
): Promise<Authority> {
  return withTenant(
    shopId,
    async (trx) => {
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

      try {
        const scope = await resolveOpeningInventoryParticipatingWarehouse(
          trx,
          shopId
        );

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

        await assertOpeningInventoryPhysicalReadiness(
          trx,
          shopId,
          scope.warehouseId
        );

        const target = await buildOpeningInventoryPhysicalTarget(
          trx,
          shopId,
          scope.warehouseId
        );

        // Same algorithm and shape Slice D froze.
        const targetFingerprint = generationFingerprint(
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

      if (identityFingerprint(identityRows) !== generation.identity_fingerprint) {
        return drift('IDENTITY_CHANGED');
      }

      return {
        ok: true as const,
        shopDomain: String(installation.shop_domain),
        encryptedAccessToken: installation.access_token,
      };
    },
    { isolationLevel: 'repeatable read' }
  );
}

async function markRequiresRegeneration(
  lease: Lease,
  reason: string
): Promise<void> {
  await withLease(lease, async (trx) => {
    await trx(EXECUTIONS)
      .where({ execution_id: lease.executionId, shop_id: lease.shopId })
      .update({
        status: 'requires_regeneration',
        terminal_at: trx.fn.now(),
        terminal_reason: `${REVALIDATION_FAILED}:${reason}`,
        lease_token: null,
        lease_expires_at: null,
        lease_heartbeat_at: null,
        updated_at: trx.fn.now(),
      });
  });
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

    if (!authority.ok) {
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

    if (!authority.ok) {
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
