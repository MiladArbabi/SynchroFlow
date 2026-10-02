import crypto from 'crypto';
import type { Knex } from 'knex';

import { withTenant } from '@lasyncro/backend-core/db.js';

import {
  getShopOpeningInventoryProgress,
  type ShopOpeningInventoryProgress,
} from './inventoryRecount.service.js';

const CUTOVERS = 'opening_inventory_cutovers';
const BATCHES = 'opening_inventory_cutover_batches';
const MAX_SHOPIFY_CHANGES_PER_BATCH = 250;

export type OpeningInventoryCutoverStatus =
  | 'prepared'
  | 'executing'
  | 'failed'
  | 'complete';

export interface OpeningInventoryShopifyChange {
  inventoryItemId: string;
  locationId: string;
  delta: number;
  changeFromQuantity: null;
}

export interface OpeningInventoryShopifyInput {
  reason: 'correction';
  name: 'available';
  referenceDocumentUri: string;
  changes: OpeningInventoryShopifyChange[];
}

export interface OpeningInventoryBatchAuditRow {
  lasyncroVariantId: string;
  openingExpectedQuantity: number;
  openingPhysicalQuantity: number;
  quantityDelta: number;
}

export interface OpeningInventoryBatchExecutionResult {
  adjustmentGroupId: string;
}

export type OpeningInventoryBatchExecutor = (params: {
  shopId: number;
  idempotencyKey: string;
  shopifyInput: OpeningInventoryShopifyInput;
}) => Promise<OpeningInventoryBatchExecutionResult>;

export interface OpeningInventoryCutoverSnapshot {
  cutover_id: string;
  shop_id: number;
  status: OpeningInventoryCutoverStatus;
  correction_variant_count: number;
  batch_count: number;
  approved_by_actor_id: string;
  approved_by_role: 'owner' | 'admin';
  approved_at: Date;
  physical_truth_accepted_at: Date | null;
  completed_at: Date | null;
  last_error: string | null;
}

export interface PrepareOpeningInventoryCutoverParams {
  shopId: number;
  actingUserId: number;
  acceptPhysicalTruth?: boolean;
}

export interface ExecuteOpeningInventoryCutoverParams {
  shopId: number;
  executor?: OpeningInventoryBatchExecutor;
}

export interface ApproveAndRunOpeningInventoryCutoverParams
  extends PrepareOpeningInventoryCutoverParams {
  executor?: OpeningInventoryBatchExecutor;
}

function normalizeShopifyGid(
  kind: 'InventoryItem' | 'Location',
  value: unknown
): string {
  const raw = String(value ?? '').trim();

  if (!raw) {
    throw new Error(
      `[OPENING_CUTOVER_PREFLIGHT] Missing Shopify ${kind} identity`
    );
  }

  if (raw.startsWith('gid://shopify/')) return raw;

  return `gid://shopify/${kind}/${raw}`;
}

function parseShopifyInput(value: unknown): OpeningInventoryShopifyInput {
  const parsed =
    typeof value === 'string'
      ? JSON.parse(value)
      : value;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      '[OPENING_CUTOVER_EXECUTE] Persisted shopify_input is not an object'
    );
  }

  return parsed as OpeningInventoryShopifyInput;
}

function snapshotFromRow(row: any): OpeningInventoryCutoverSnapshot {
  return {
    cutover_id: String(row.cutover_id),
    shop_id: Number(row.shop_id),
    status: String(row.status) as OpeningInventoryCutoverStatus,
    correction_variant_count:
      Number(row.correction_variant_count),
    batch_count: Number(row.batch_count),
    approved_by_actor_id:
      String(row.approved_by_actor_id),
    approved_by_role:
      String(row.approved_by_role) as 'owner' | 'admin',
    approved_at: new Date(row.approved_at),
    physical_truth_accepted_at:
      row.physical_truth_accepted_at
        ? new Date(row.physical_truth_accepted_at)
        : null,
    completed_at:
      row.completed_at
        ? new Date(row.completed_at)
        : null,
    last_error:
      row.last_error === null ||
      row.last_error === undefined
        ? null
        : String(row.last_error),
  };
}

async function acquireCutoverLock(
  trx: Knex.Transaction,
  shopId: number
): Promise<void> {
  await trx.raw(
    'SELECT pg_advisory_xact_lock(hashtext(?), ?)',
    ['opening_inventory_cutover', shopId]
  );
}

async function requireActiveApprover(
  trx: Knex.Transaction,
  shopId: number,
  actingUserId: number
): Promise<'owner' | 'admin'> {
  const membership = await trx('shop_memberships')
    .where({
      shop_id: shopId,
      user_id: actingUserId,
    })
    .whereNull('revoked_at')
    .select('role')
    .first();

  if (!membership) {
    throw new Error(
      '[OPENING_CUTOVER_FORBIDDEN] Active shop membership required'
    );
  }

  const role = String(membership.role);

  if (role !== 'owner' && role !== 'admin') {
    throw new Error(
      '[OPENING_CUTOVER_FORBIDDEN] Only owner/admin may approve opening inventory cutover'
    );
  }

  return role;
}

async function requireShopifyInstallation(
  trx: Knex.Transaction,
  shopId: number
): Promise<void> {
  const installation = await trx('shopify_app_installations')
    .where({ shop_id: shopId })
    .select('shop_domain', 'access_token')
    .first();

  if (
    !installation?.shop_domain ||
    !installation?.access_token
  ) {
    throw new Error(
      `[OPENING_CUTOVER_PREFLIGHT] Shopify installation missing for shop ${shopId}`
    );
  }
}

async function resolveSingleMappedLocation(
  trx: Knex.Transaction,
  shopId: number
): Promise<string> {
  const activeWarehouses = await trx('warehouses')
    .where({
      shop_id: shopId,
      active: true,
    })
    .select(
      'warehouse_id',
      'external_location_id'
    )
    .orderBy('warehouse_id', 'asc');

  if (activeWarehouses.length === 0) {
    throw new Error(
      '[OPENING_CUTOVER_LOCATION] No active warehouse available for Shopify correction'
    );
  }

  const unmapped = activeWarehouses.filter(
    (warehouse: any) =>
      !String(warehouse.external_location_id ?? '').trim()
  );

  if (unmapped.length > 0) {
    throw new Error(
      '[OPENING_CUTOVER_LOCATION] Every active warehouse must have a Shopify location mapping before aggregate correction'
    );
  }

  if (activeWarehouses.length > 1) {
    throw new Error(
      '[OPENING_CUTOVER_LOCATION] Multiple active mapped Shopify warehouse locations require explicit distribution'
    );
  }

  return normalizeShopifyGid(
    'Location',
    activeWarehouses[0].external_location_id
  );
}

async function resolveInventoryItemIds(
  trx: Knex.Transaction,
  shopId: number,
  variantIds: string[]
): Promise<Map<string, string>> {
  if (variantIds.length === 0) {
    return new Map();
  }

  const rows = await trx('external_product_identity_map')
    .where({
      shop_id: shopId,
      platform: 'shopify',
    })
    .whereIn('lasyncro_variant_id', variantIds)
    .select(
      'lasyncro_variant_id',
      'external_inventory_item_id'
    );

  const grouped = new Map<string, Set<string>>();

  for (const row of rows) {
    const variantId =
      String(row.lasyncro_variant_id);

    const externalId =
      String(
        row.external_inventory_item_id ?? ''
      ).trim();

    if (!externalId) continue;

    const current =
      grouped.get(variantId) ?? new Set<string>();

    current.add(externalId);
    grouped.set(variantId, current);
  }

  const result = new Map<string, string>();

  for (const variantId of variantIds) {
    const ids = grouped.get(variantId);

    if (!ids || ids.size === 0) {
      throw new Error(
        `[OPENING_CUTOVER_IDENTITY] Missing Shopify inventory item for variant ${variantId}`
      );
    }

    if (ids.size !== 1) {
      throw new Error(
        `[OPENING_CUTOVER_IDENTITY] Ambiguous Shopify inventory item for variant ${variantId}`
      );
    }

    result.set(
      variantId,
      normalizeShopifyGid(
        'InventoryItem',
        Array.from(ids)[0]
      )
    );
  }

  return result;
}

function chunk<T>(
  values: T[],
  size: number
): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function readCutover(
  trx: Knex.Transaction,
  shopId: number
): Promise<any | undefined> {
  return trx(CUTOVERS)
    .where({ shop_id: shopId })
    .first();
}

export async function prepareOpeningInventoryCutover(
  params: PrepareOpeningInventoryCutoverParams
): Promise<OpeningInventoryCutoverSnapshot> {
  const {
    shopId,
    actingUserId,
    acceptPhysicalTruth = false,
  } = params;

  return withTenant(shopId, async (trx) => {
    await acquireCutoverLock(trx, shopId);

    const approvedRole =
      await requireActiveApprover(
        trx,
        shopId,
        actingUserId
      );

    const existing = await readCutover(
      trx,
      shopId
    );

    if (existing) {
      return snapshotFromRow(existing);
    }

    const progress =
      await getShopOpeningInventoryProgress(
        trx,
        shopId
      );

    if (
      progress.state !== 'ready_for_cutover' &&
      progress.state !== 'review_required'
    ) {
      throw new Error(
        `[OPENING_CUTOVER_NOT_READY] Opening reconciliation state is ${progress.state}`
      );
    }

    if (
      progress.state === 'review_required' &&
      acceptPhysicalTruth !== true
    ) {
      throw new Error(
        '[OPENING_CUTOVER_ACCEPTANCE_REQUIRED] Merchant must explicitly accept LaSyncro physical count as truth'
      );
    }

    const differences = [
      ...progress.differences,
    ].sort((a, b) =>
      a.lasyncro_variant_id.localeCompare(
        b.lasyncro_variant_id
      )
    );

    const cutoverId =
      crypto.randomUUID();

    const approvedAt =
      new Date();

    /**
     * GH-1179: differences are computed against
     * shopify_opening_inventory_expectations, an aggregate per-variant
     * snapshot with no warehouse or Shopify Location provenance. A zero
     * difference therefore proves nothing about the mapped location's
     * Shopify inventory and must never certify the opening Shopify sync.
     */
    if (differences.length === 0) {
      throw new Error(
        '[OPENING_CUTOVER_PREFLIGHT] A location-scoped Shopify inventory snapshot is required before opening inventory can be reconciled with Shopify'
      );
    }

    await requireShopifyInstallation(
      trx,
      shopId
    );

    const locationId =
      await resolveSingleMappedLocation(
        trx,
        shopId
      );

    const variantIds =
      differences.map(
        (row) => row.lasyncro_variant_id
      );

    const inventoryItemIds =
      await resolveInventoryItemIds(
        trx,
        shopId,
        variantIds
      );

    const preparedRows =
      differences.map((difference) => {
        const inventoryItemId =
          inventoryItemIds.get(
            difference.lasyncro_variant_id
          );

        if (!inventoryItemId) {
          throw new Error(
            `[OPENING_CUTOVER_IDENTITY] Missing frozen Shopify identity for variant ${difference.lasyncro_variant_id}`
          );
        }

        return {
          shopifyChange: {
            inventoryItemId,
            locationId,
            delta: difference.delta,
            changeFromQuantity: null,
          } satisfies OpeningInventoryShopifyChange,
          audit: {
            lasyncroVariantId:
              difference.lasyncro_variant_id,
            openingExpectedQuantity:
              difference.expected_quantity,
            openingPhysicalQuantity:
              difference.observed_quantity,
            quantityDelta:
              difference.delta,
          } satisfies OpeningInventoryBatchAuditRow,
        };
      });

    const groups = chunk(
      preparedRows,
      MAX_SHOPIFY_CHANGES_PER_BATCH
    );

    await trx(CUTOVERS).insert({
      cutover_id: cutoverId,
      shop_id: shopId,
      status: 'prepared',
      approved_by_actor_type: 'user',
      approved_by_actor_id:
        String(actingUserId),
      approved_by_role: approvedRole,
      approved_at: approvedAt,
      physical_truth_accepted_at:
        approvedAt,
      correction_variant_count:
        differences.length,
      batch_count: groups.length,
      last_error: null,
      completed_at: null,
    });

    for (
      let index = 0;
      index < groups.length;
      index += 1
    ) {
      const batchSequence =
        index + 1;

      const group =
        groups[index];

      const idempotencyKey =
        `lasyncro:opening-cutover:${cutoverId}:${batchSequence}`;

      const shopifyInput: OpeningInventoryShopifyInput = {
        reason: 'correction',
        name: 'available',
        referenceDocumentUri:
          `gid://lasyncro/OpeningInventoryCutover/${cutoverId}/batch/${batchSequence}`,
        changes: group.map(
          (row) => row.shopifyChange
        ),
      };

      const auditSnapshot =
        group.map(
          (row) => row.audit
        );

      await trx(BATCHES).insert({
        cutover_id: cutoverId,
        shop_id: shopId,
        batch_sequence:
          batchSequence,
        idempotency_key:
          idempotencyKey,
        shopify_input:
          JSON.stringify(shopifyInput),
        audit_snapshot:
          JSON.stringify(auditSnapshot),
        status: 'pending',
        attempt_count: 0,
        last_attempted_at: null,
        last_error: null,
        shopify_adjustment_group_id: null,
        completed_at: null,
      });
    }

    const created =
      await readCutover(
        trx,
        shopId
      );

    if (!created) {
      throw new Error(
        '[OPENING_CUTOVER_INTERNAL] Prepared cutover disappeared before transaction commit'
      );
    }

    return snapshotFromRow(created);
  });
}

async function defaultBatchExecutor(
  params: Parameters<OpeningInventoryBatchExecutor>[0]
): Promise<OpeningInventoryBatchExecutionResult> {
  const module = await import(
    './shopifyOpeningInventoryCutover.service.js'
  );

  return module.executeOpeningInventoryCutoverBatch(
    params
  );
}

async function beginBatchAttempt(
  shopId: number,
  cutoverId: string,
  batchSequence: number
): Promise<
  | {
      skip: true;
    }
  | {
      skip: false;
      idempotencyKey: string;
      shopifyInput: OpeningInventoryShopifyInput;
    }
> {
  return withTenant(
    shopId,
    async (trx) => {
      const batch = await trx(BATCHES)
        .where({
          shop_id: shopId,
          cutover_id: cutoverId,
          batch_sequence:
            batchSequence,
        })
        .forUpdate()
        .first();

      if (!batch) {
        throw new Error(
          `[OPENING_CUTOVER_EXECUTE] Batch ${batchSequence} missing`
        );
      }

      if (batch.status === 'succeeded') {
        return { skip: true };
      }

      await trx(BATCHES)
        .where({ id: batch.id })
        .update({
          status: 'in_flight',
          attempt_count:
            trx.raw(
              'attempt_count + 1'
            ),
          last_attempted_at:
            trx.fn.now(),
          last_error: null,
          updated_at:
            trx.fn.now(),
        });

      return {
        skip: false,
        idempotencyKey:
          String(batch.idempotency_key),
        shopifyInput:
          parseShopifyInput(
            batch.shopify_input
          ),
      };
    }
  );
}

async function persistBatchSuccess(
  shopId: number,
  cutoverId: string,
  batchSequence: number,
  adjustmentGroupId: string
): Promise<void> {
  await withTenant(
    shopId,
    async (trx) => {
      const batch = await trx(BATCHES)
        .where({
          shop_id: shopId,
          cutover_id: cutoverId,
          batch_sequence:
            batchSequence,
        })
        .forUpdate()
        .first();

      if (!batch) {
        throw new Error(
          `[OPENING_CUTOVER_EXECUTE] Batch ${batchSequence} missing after Shopify success`
        );
      }

      if (batch.status === 'succeeded') {
        return;
      }

      const completedAt =
        new Date();

      await trx(BATCHES)
        .where({ id: batch.id })
        .update({
          status: 'succeeded',
          shopify_adjustment_group_id:
            adjustmentGroupId,
          last_error: null,
          completed_at:
            completedAt,
          updated_at:
            completedAt,
        });
    }
  );
}

async function persistBatchFailure(
  shopId: number,
  cutoverId: string,
  batchSequence: number,
  error: unknown
): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  await withTenant(
    shopId,
    async (trx) => {
      const batch = await trx(BATCHES)
        .where({
          shop_id: shopId,
          cutover_id: cutoverId,
          batch_sequence:
            batchSequence,
        })
        .forUpdate()
        .first();

      if (
        batch &&
        batch.status !== 'succeeded'
      ) {
        await trx(BATCHES)
          .where({ id: batch.id })
          .update({
            status: 'failed',
            last_error: message,
            completed_at: null,
            updated_at:
              trx.fn.now(),
          });
      }

      const cutover =
        await trx(CUTOVERS)
          .where({
            shop_id: shopId,
            cutover_id: cutoverId,
          })
          .forUpdate()
          .first();

      /**
       * GRILL-02:
       * A concurrent executor may report a stale failure after another
       * executor has already persisted this same batch as succeeded.
       *
       * Batch success is monotonic. A stale loser must therefore not regress
       * the parent aggregate to failed merely because it completed later.
       *
       * Missing batches remain a real execution failure and still fail the
       * parent.
       */
      const shouldFailCutover =
        !batch ||
        batch.status !== 'succeeded';

      if (
        cutover &&
        cutover.status !== 'complete' &&
        shouldFailCutover
      ) {
        await trx(CUTOVERS)
          .where({
            cutover_id:
              cutoverId,
          })
          .update({
            status: 'failed',
            last_error: message,
            completed_at: null,
            updated_at:
              trx.fn.now(),
          });
      }
    }
  );
}

async function finalizeCutoverIfComplete(
  shopId: number,
  cutoverId: string
): Promise<OpeningInventoryCutoverSnapshot> {
  return withTenant(
    shopId,
    async (trx) => {
      await acquireCutoverLock(
        trx,
        shopId
      );

      const cutover =
        await trx(CUTOVERS)
          .where({
            shop_id: shopId,
            cutover_id: cutoverId,
          })
          .forUpdate()
          .first();

      if (!cutover) {
        throw new Error(
          '[OPENING_CUTOVER_EXECUTE] Cutover missing during completion'
        );
      }

      if (cutover.status === 'complete') {
        return snapshotFromRow(cutover);
      }

      const totalBatchRow = await trx(BATCHES)
        .where({
          shop_id: shopId,
          cutover_id: cutoverId,
        })
        .count<{ count: string }>(
          '* as count'
        )
        .first();

      const succeededBatchRow = await trx(BATCHES)
        .where({
          shop_id: shopId,
          cutover_id: cutoverId,
          status: 'succeeded',
        })
        .count<{ count: string }>(
          '* as count'
        )
        .first();

      const requiredBatchCount =
        Number(cutover.batch_count);

      const totalBatchCount =
        Number(totalBatchRow?.count ?? 0);

      const succeededBatchCount =
        Number(succeededBatchRow?.count ?? 0);

      if (
        totalBatchCount !== requiredBatchCount ||
        succeededBatchCount !== requiredBatchCount
      ) {
        const current =
          await trx(CUTOVERS)
            .where({
              cutover_id:
                cutoverId,
            })
            .first();

        return snapshotFromRow(current);
      }

      const completedAt =
        new Date();

      const [completed] =
        await trx(CUTOVERS)
          .where({
            cutover_id:
              cutoverId,
          })
          .update({
            status: 'complete',
            last_error: null,
            completed_at:
              completedAt,
            updated_at:
              completedAt,
          })
          .returning('*');

      await trx('shop_wms_settings')
        .where({
          shop_id: shopId,
        })
        .update({
          opening_inventory_shopify_synced_at:
            completedAt,
        });

      return snapshotFromRow(
        completed
      );
    }
  );
}

export async function executeOpeningInventoryCutover(
  params: ExecuteOpeningInventoryCutoverParams
): Promise<OpeningInventoryCutoverSnapshot> {
  const {
    shopId,
    executor =
      defaultBatchExecutor,
  } = params;

  const cutover =
    await withTenant(
      shopId,
      async (trx) => {
        const row =
          await trx(CUTOVERS)
            .where({
              shop_id: shopId,
            })
            .first();

        if (!row) {
          throw new Error(
            '[OPENING_CUTOVER_EXECUTE] No prepared cutover exists'
          );
        }

        if (
          row.status !== 'complete'
        ) {
          await trx(CUTOVERS)
            .where({
              cutover_id:
                row.cutover_id,
            })
            .update({
              status: 'executing',
              last_error: null,
              updated_at:
                trx.fn.now(),
            });

          row.status =
            'executing';
          row.last_error =
            null;
        }

        return row;
      }
    );

  if (cutover.status === 'complete') {
    return snapshotFromRow(
      cutover
    );
  }

  const batches =
    await withTenant(
      shopId,
      (trx) =>
        trx(BATCHES)
          .where({
            shop_id: shopId,
            cutover_id:
              cutover.cutover_id,
          })
          .select(
            'batch_sequence'
          )
          .orderBy(
            'batch_sequence',
            'asc'
          )
    );

  for (const row of batches) {
    const batchSequence =
      Number(
        row.batch_sequence
      );

    const attempt =
      await beginBatchAttempt(
        shopId,
        String(
          cutover.cutover_id
        ),
        batchSequence
      );

    if (attempt.skip) {
      continue;
    }

    try {
      const result =
        await executor({
          shopId,
          idempotencyKey:
            attempt.idempotencyKey,
          shopifyInput:
            attempt.shopifyInput,
        });

      if (
        !result.adjustmentGroupId
      ) {
        throw new Error(
          '[OPENING_CUTOVER_EXECUTE] Shopify success did not return adjustment group id'
        );
      }

      await persistBatchSuccess(
        shopId,
        String(
          cutover.cutover_id
        ),
        batchSequence,
        result.adjustmentGroupId
      );
    } catch (error) {
      await persistBatchFailure(
        shopId,
        String(
          cutover.cutover_id
        ),
        batchSequence,
        error
      );

      throw error;
    }
  }

  return finalizeCutoverIfComplete(
    shopId,
    String(
      cutover.cutover_id
    )
  );
}

export async function approveAndRunOpeningInventoryCutover(
  params: ApproveAndRunOpeningInventoryCutoverParams
): Promise<OpeningInventoryCutoverSnapshot> {
  const prepared =
    await prepareOpeningInventoryCutover({
      shopId: params.shopId,
      actingUserId:
        params.actingUserId,
      acceptPhysicalTruth:
        params.acceptPhysicalTruth,
    });

  if (
    prepared.status === 'complete'
  ) {
    return prepared;
  }

  return executeOpeningInventoryCutover({
    shopId: params.shopId,
    executor: params.executor,
  });
}

export type OpeningInventoryCutoverErrorCode =
  | 'OPENING_CUTOVER_FORBIDDEN'
  | 'OPENING_CUTOVER_NOT_READY'
  | 'OPENING_CUTOVER_ACCEPTANCE_REQUIRED'
  | 'OPENING_CUTOVER_PREFLIGHT'
  | 'OPENING_CUTOVER_LOCATION'
  | 'OPENING_CUTOVER_IDENTITY'
  | 'OPENING_CUTOVER_SHOPIFY'
  | 'OPENING_CUTOVER_EXECUTE'
  | 'OPENING_CUTOVER_INTERNAL';

export interface OpeningInventoryCutoverPublicError {
  code: OpeningInventoryCutoverErrorCode;
  message: string;
}

/**
 * Service-authored rejections whose text is written for the merchant and
 * carries no provider/runtime payload: the stripped message is public.
 */
const DESCRIPTIVE_CUTOVER_ERROR_CODES = new Set<OpeningInventoryCutoverErrorCode>([
  'OPENING_CUTOVER_FORBIDDEN',
  'OPENING_CUTOVER_NOT_READY',
  'OPENING_CUTOVER_ACCEPTANCE_REQUIRED',
  'OPENING_CUTOVER_PREFLIGHT',
  'OPENING_CUTOVER_LOCATION',
  'OPENING_CUTOVER_IDENTITY',
]);

/**
 * Execution failures may embed provider responses or internal detail, so
 * only a fixed message is ever public for them.
 */
const FIXED_PUBLIC_CUTOVER_ERROR_MESSAGES: Record<
  'OPENING_CUTOVER_SHOPIFY' | 'OPENING_CUTOVER_EXECUTE' | 'OPENING_CUTOVER_INTERNAL',
  string
> = {
  OPENING_CUTOVER_SHOPIFY:
    'Shopify did not accept the opening inventory update. Retry to resume the same sync.',
  OPENING_CUTOVER_EXECUTE:
    'The opening inventory sync could not finish. Retry to resume the same sync.',
  OPENING_CUTOVER_INTERNAL:
    'The opening inventory sync failed unexpectedly. Retry to resume the same sync.',
};

/**
 * Pure classifier from a raw cutover error (thrown or persisted) to its
 * merchant-safe public form. Only a leading stable prefix is authoritative;
 * anything else is OPENING_CUTOVER_INTERNAL with a generic message, so raw
 * provider/runtime text never leaves the backend. Carries no HTTP status.
 */
export function classifyOpeningInventoryCutoverError(
  error: unknown
): OpeningInventoryCutoverPublicError {
  const raw =
    error instanceof Error
      ? error.message
      : String(error ?? '');

  const match = /^\[([A-Z_]+)\]\s*(.*)$/s.exec(raw);
  const code = match?.[1] as OpeningInventoryCutoverErrorCode | undefined;

  if (code && DESCRIPTIVE_CUTOVER_ERROR_CODES.has(code)) {
    return {
      code,
      message: match?.[2] || code,
    };
  }

  if (
    code === 'OPENING_CUTOVER_SHOPIFY' ||
    code === 'OPENING_CUTOVER_EXECUTE'
  ) {
    return {
      code,
      message: FIXED_PUBLIC_CUTOVER_ERROR_MESSAGES[code],
    };
  }

  return {
    code: 'OPENING_CUTOVER_INTERNAL',
    message:
      FIXED_PUBLIC_CUTOVER_ERROR_MESSAGES.OPENING_CUTOVER_INTERNAL,
  };
}

export interface OpeningInventoryCutoverView {
  progress: ShopOpeningInventoryProgress;
  cutover: {
    status: OpeningInventoryCutoverStatus;
    /** Derived only from persisted physical_truth_accepted_at. */
    physical_truth_accepted: boolean;
    /** Public classification of persisted last_error; raw text is never exposed. */
    error_code: OpeningInventoryCutoverErrorCode | null;
    error_message: string | null;
    completed_at: Date | null;
  } | null;
  shopify_synced_at: Date | null;
}

/**
 * Read-only merchant view for the opening inventory cutover surface.
 *
 * Composes the canonical shop-wide opening reconciliation progress with the
 * persisted cutover execution state and the shop-level Shopify sync marker.
 * Takes no lock and never prepares, executes or mutates a cutover. The
 * persisted diagnostic last_error stays in the database; only its public
 * classification is returned.
 */
export async function getOpeningInventoryCutoverView(
  shopId: number
): Promise<OpeningInventoryCutoverView> {
  return withTenant(shopId, async (trx) => {
    const progress =
      await getShopOpeningInventoryProgress(
        trx,
        shopId
      );

    const cutover = await readCutover(
      trx,
      shopId
    );

    const settings = await trx('shop_wms_settings')
      .where({ shop_id: shopId })
      .select('opening_inventory_shopify_synced_at')
      .first();

    const snapshot = cutover
      ? snapshotFromRow(cutover)
      : null;

    const publicError =
      snapshot?.last_error
        ? classifyOpeningInventoryCutoverError(
            snapshot.last_error
          )
        : null;

    return {
      progress,
      cutover: snapshot
        ? {
            status: snapshot.status,
            physical_truth_accepted:
              snapshot.physical_truth_accepted_at !== null,
            error_code:
              publicError?.code ?? null,
            error_message:
              publicError?.message ?? null,
            completed_at: snapshot.completed_at,
          }
        : null,
      shopify_synced_at:
        settings?.opening_inventory_shopify_synced_at
          ? new Date(
              settings.opening_inventory_shopify_synced_at
            )
          : null,
    };
  });
}

export {
  createOpeningInventoryCutoverGeneration,
  type CreateOpeningInventoryCutoverGenerationParams,
  type CreateOpeningInventoryCutoverGenerationDeps,
} from './openingInventoryCutoverGeneration.service.js';
