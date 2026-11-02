// apps/backend/src/services/wms/shopifyRecoveryInventorySync.service.ts
//
// S4-5 I4 — durable Shopify synchronisation of certified I3 recovery credits.
//
// Per credit (one row in shopify_recovery_inventory_syncs, 0228):
//   discover   recovered event ⋈ its I3 ledger credit (never written here)
//   classify   in REPEATABLE READ under the opening-cutover advisory lock:
//                no completion marker                → held_no_baseline
//                marker without one converged gen    → held_legacy_baseline (N1)
//                converged gen without capture       → held_no_capture (N5)
//                credit outside the baseline warehouse → held_no_baseline
//                credit captured at freeze (CB1)     → skipped_included
//                otherwise                           → pending
//              held rows are re-classified on later sweeps (OD3).
//   dispatch   claim with a lease token → freeze the request once (mapping) →
//              resolve the credential outside any transaction → commit
//              'dispatching' → ONE inventoryAdjustQuantities +1 (available,
//              reason correction, stable idempotency key, frozen payload) with
//              no transaction open → fenced outcome:
//                adjustment group returned → succeeded
//                userErrors                → rejected
//                anything else / thrown    → ambiguous (retried with the
//                identical payload and key while < 23 h after first dispatch,
//                then held_expired: exact evidence or manual reconciliation, N2)
//              A crashed 'dispatching' claim becomes ambiguous on lease expiry.
//
// Missing mapping or credential never drops a credit and never calls Shopify.
// Ordinary inbound Stow sync (shopifyInventorySync.service.ts) is untouched.

import crypto from 'crypto';
import type { Knex } from 'knex';

import { withTenant } from '@lasyncro/backend-core/db.js';
import { resolveShopifyAdminCredentialForConsumer } from '../shopify/shopifyAdminCredentialConsumer.service.js';
import { RECOVERY_CAPTURE_CREDITS, RECOVERY_CAPTURE_HEADERS } from './openingInventoryRecoveryCapture.service.js';

export const RECOVERY_SYNCS = 'shopify_recovery_inventory_syncs';

const LEASE_SECONDS = 120;
const RETRY_CUTOFF_HOURS = 23;
const MAX_DISPATCHES_PER_SHOP_RUN = 25;

export const RECOVERY_INVENTORY_ADJUST_MUTATION = `
  mutation inventoryAdjustQuantities(
    $input: InventoryAdjustQuantitiesInput!
    $idempotencyKey: String!
  ) {
    inventoryAdjustQuantities(input: $input)
      @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export interface RecoveryShopifyClient {
  request: (document: string, options?: { variables?: unknown }) => Promise<unknown>;
}

export interface ShopifyRecoveryInventorySyncDeps {
  createShopifyGraphQLClient?: (args: {
    accessToken: string;
    platformShopName: string;
    shopId: number;
  }) => RecoveryShopifyClient;
}

export interface RecoveryCreditIdentity {
  creditMovementId: string;
  deviceEventId: string;
  lasyncroUnitId: string;
  lasyncroVariantId: string;
  locationCode: string;
}

export type RecoveryClassification = {
  status:
    | 'held_no_baseline'
    | 'held_legacy_baseline'
    | 'held_no_capture'
    | 'skipped_included'
    | 'pending';
  holdReason: string | null;
  baselineGenerationId: string | null;
};

export function recoverySyncIdentity(shopId: number, creditMovementId: string) {
  return {
    idempotencyKey: `lasyncro:receive-recovery:${shopId}:${creditMovementId}`,
    referenceDocumentUri: `gid://lasyncro/ReceiveRecoveryCredit/shop-${shopId}-movement-${creditMovementId}`,
  };
}

/** Same per-shop serialization key as cutover generation and execution claims. */
async function acquireCutoverLock(trx: Knex.Transaction, shopId: number): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', ['opening_inventory_cutover', shopId]);
}

const held = (
  status: RecoveryClassification['status'],
  holdReason: string
): RecoveryClassification => ({ status, holdReason, baselineGenerationId: null });

/**
 * Baseline decision for one credit, inside the caller's REPEATABLE READ
 * transaction (cutover lock already held). A stale snapshot can only HOLD.
 */
export async function classifyRecoveryCredit(
  trx: Knex.Transaction,
  shopId: number,
  credit: Pick<RecoveryCreditIdentity, 'creditMovementId' | 'locationCode'>
): Promise<RecoveryClassification> {
  const settings = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .first('opening_inventory_shopify_synced_at');
  if (!settings?.opening_inventory_shopify_synced_at) {
    return held('held_no_baseline', 'NO_CONVERGED_CUTOVER');
  }

  const converged = await trx('opening_inventory_cutover_executions as e')
    .join('opening_inventory_cutover_generations as g', function joinGeneration() {
      this.on('g.generation_id', '=', 'e.generation_id').andOn('g.shop_id', '=', 'e.shop_id');
    })
    .where({ 'e.shop_id': shopId, 'e.status': 'converged' })
    .select('g.generation_id', 'g.warehouse_id');
  if (converged.length !== 1) {
    return held('held_legacy_baseline', 'MARKER_WITHOUT_CONVERGED_GENERATION');
  }

  const generationId = String(converged[0].generation_id);
  const warehouseId = String(converged[0].warehouse_id);

  const header = await trx(RECOVERY_CAPTURE_HEADERS)
    .where({ shop_id: shopId, generation_id: generationId })
    .first('warehouse_id');
  if (!header) {
    return held('held_no_capture', 'BASELINE_WITHOUT_RECOVERY_CAPTURE');
  }

  const location = await trx('warehouse_locations')
    .where({ shop_id: shopId, location_code: credit.locationCode })
    .first('warehouse_id');
  if (!location || String(location.warehouse_id) !== warehouseId) {
    return held('held_no_baseline', 'WAREHOUSE_NOT_IN_BASELINE');
  }

  const included = await trx(RECOVERY_CAPTURE_CREDITS)
    .where({ shop_id: shopId, generation_id: generationId, credit_movement_id: credit.creditMovementId })
    .first('credit_movement_id');

  return included
    ? { status: 'skipped_included', holdReason: null, baselineGenerationId: generationId }
    : { status: 'pending', holdReason: null, baselineGenerationId: generationId };
}

const HELD_STATUSES = ['held_no_baseline', 'held_legacy_baseline', 'held_no_capture'];

/**
 * Discover new credits and re-classify held ones. Idempotent. The REPEATABLE
 * READ snapshot is taken before the cutover lock, so a concurrent sweeper can
 * fail with a serialization error instead of duplicating; retried, bounded.
 */
export async function sweepRecoveryCredits(shopId: number): Promise<{ registered: number; reclassified: number }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await sweepRecoveryCreditsOnce(shopId);
    } catch (error) {
      if ((error as any)?.code !== '40001' || attempt >= 3) throw error;
    }
  }
}

async function sweepRecoveryCreditsOnce(shopId: number): Promise<{ registered: number; reclassified: number }> {
  return withTenant(
    shopId,
    async (trx) => {
      await acquireCutoverLock(trx, shopId);

      const discovered = await trx('receive_held_recovery_events as e')
        .join('inventory_movements as m', function joinCredit() {
          this.on('m.shop_id', '=', 'e.shop_id')
            .andOn('m.device_event_id', '=', 'e.device_event_id')
            .andOn('m.location_code', '=', 'e.location_code');
        })
        .where({
          'e.shop_id': shopId,
          'e.outcome': 'recovered',
          'm.movement_type': 'inbound_purchase',
          'm.reference_type': 'inventory_unit',
          'm.triggered_by': 'receive_recovery',
          'm.quantity_delta': 1,
        })
        .whereNotExists(function existingSync() {
          this.select(trx.raw('1'))
            .from(`${RECOVERY_SYNCS} as s`)
            .whereRaw('s.shop_id = e.shop_id AND s.device_event_id = e.device_event_id');
        })
        .orderBy('m.lasyncro_inventory_movement_id', 'asc')
        .select(
          'm.lasyncro_inventory_movement_id',
          'm.device_event_id',
          'e.lasyncro_unit_id',
          'm.lasyncro_variant_id',
          'm.location_code'
        );

      let registered = 0;
      for (const row of discovered) {
        const creditMovementId = String(row.lasyncro_inventory_movement_id);
        const decision = await classifyRecoveryCredit(trx, shopId, {
          creditMovementId,
          locationCode: String(row.location_code),
        });
        const identity = recoverySyncIdentity(shopId, creditMovementId);
        const inserted = await trx(RECOVERY_SYNCS)
          .insert({
            shop_id: shopId,
            credit_movement_id: creditMovementId,
            device_event_id: String(row.device_event_id),
            lasyncro_unit_id: String(row.lasyncro_unit_id),
            lasyncro_variant_id: String(row.lasyncro_variant_id),
            location_code: String(row.location_code),
            idempotency_key: identity.idempotencyKey,
            reference_document_uri: identity.referenceDocumentUri,
            status: decision.status,
            hold_reason: decision.holdReason,
            baseline_generation_id: decision.baselineGenerationId,
          })
          .onConflict()
          .ignore()
          .returning('credit_movement_id');
        registered += inserted.length;
      }

      const heldRows = await trx(RECOVERY_SYNCS)
        .where({ shop_id: shopId })
        .whereIn('status', HELD_STATUSES)
        .forUpdate()
        .skipLocked()
        .select('credit_movement_id', 'location_code', 'status', 'hold_reason');

      let reclassified = 0;
      for (const row of heldRows) {
        const decision = await classifyRecoveryCredit(trx, shopId, {
          creditMovementId: String(row.credit_movement_id),
          locationCode: String(row.location_code),
        });
        if (decision.status === row.status && decision.holdReason === row.hold_reason) continue;
        await trx(RECOVERY_SYNCS)
          .where({ shop_id: shopId, credit_movement_id: row.credit_movement_id })
          .update({
            status: decision.status,
            hold_reason: decision.holdReason,
            baseline_generation_id: decision.baselineGenerationId,
          });
        reclassified += 1;
      }

      return { registered, reclassified };
    },
    { isolationLevel: 'repeatable read' }
  );
}

// ─── dispatch ───────────────────────────────────────────────────────────────

interface FrozenRequest {
  idempotencyKey: string;
  input: {
    reason: 'correction';
    name: 'available';
    referenceDocumentUri: string;
    changes: Array<{
      inventoryItemId: string;
      locationId: string;
      delta: 1;
      changeFromQuantity: null;
    }>;
  };
}

function buildRequest(row: any): FrozenRequest {
  return {
    idempotencyKey: String(row.idempotency_key),
    input: {
      reason: 'correction',
      name: 'available',
      referenceDocumentUri: String(row.reference_document_uri),
      changes: [
        {
          inventoryItemId: String(row.request_inventory_item_gid),
          locationId: String(row.request_location_gid),
          delta: 1,
          changeFromQuantity: null,
        },
      ],
    },
  };
}

export function requestSha256(request: FrozenRequest): string {
  return crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw.slice(0, 500);
}

type Claim = { token: string; row: any };

export type DispatchOutcome =
  | { kind: 'IDLE' }
  | { kind: 'BLOCKED_MAPPING' | 'BLOCKED_CREDENTIAL' | 'CREDENTIAL_RETRY' | 'FENCED'; creditMovementId: string }
  | { kind: 'SUCCEEDED' | 'REJECTED' | 'AMBIGUOUS'; creditMovementId: string };

/** Lease housekeeping + one fenced claim; freezes the request on first use. */
async function claimNext(shopId: number): Promise<Claim | { blocked: string } | null> {
  return withTenant(shopId, async (trx) => {
    // A crashed dispatch may have reached Shopify: never assume it did not.
    await trx(RECOVERY_SYNCS)
      .where({ shop_id: shopId, status: 'dispatching' })
      .where('lease_expires_at', '<', trx.fn.now())
      .update({ status: 'ambiguous', lease_token: null, lease_expires_at: null, last_error: 'LEASE_EXPIRED_DURING_DISPATCH' });
    await trx(RECOVERY_SYNCS)
      .where({ shop_id: shopId })
      .whereNot('status', 'dispatching')
      .where('lease_expires_at', '<', trx.fn.now())
      .update({ lease_token: null, lease_expires_at: null });
    await trx(RECOVERY_SYNCS)
      .where({ shop_id: shopId, status: 'ambiguous' })
      .whereNull('lease_token')
      .whereRaw(`first_dispatched_at + interval '${RETRY_CUTOFF_HOURS} hours' <= now()`)
      .update({ status: 'held_expired', hold_reason: 'RETRY_WINDOW_EXPIRED' });

    const row = await trx(RECOVERY_SYNCS)
      .where({ shop_id: shopId })
      .whereIn('status', ['pending', 'blocked_mapping', 'blocked_credential', 'ambiguous'])
      .whereNull('lease_token')
      .where((ready) => {
        ready
          .whereNull('last_attempt_at')
          .orWhereRaw(
            `last_attempt_at <= now() - make_interval(secs => LEAST(300, 5 * power(2, LEAST(attempt_count, 6))::integer))`
          );
      })
      .orderBy('created_at', 'asc')
      .forUpdate()
      .skipLocked()
      .first();
    if (!row) return null;

    const token = crypto.randomUUID();
    const patch: Record<string, unknown> = {
      lease_token: token,
      lease_expires_at: trx.raw(`now() + interval '${LEASE_SECONDS} seconds'`),
    };

    if (!row.request_payload_sha256) {
      const identity = await trx('external_product_identity_map')
        .where({ shop_id: shopId, lasyncro_variant_id: row.lasyncro_variant_id })
        .first('external_inventory_item_id');
      const location = await trx('warehouse_locations as wl')
        .join('warehouses as w', function joinWarehouse() {
          this.on('w.warehouse_id', '=', 'wl.warehouse_id').andOn('w.shop_id', '=', 'wl.shop_id');
        })
        .where({ 'wl.shop_id': shopId, 'wl.location_code': row.location_code })
        .first('w.external_location_id');

      if (!identity?.external_inventory_item_id || !location?.external_location_id) {
        await trx(RECOVERY_SYNCS)
          .where({ shop_id: shopId, credit_movement_id: row.credit_movement_id })
          .update({
            status: 'blocked_mapping',
            last_attempt_at: trx.fn.now(),
            last_error: !identity?.external_inventory_item_id ? 'INVENTORY_ITEM_MAPPING_MISSING' : 'LOCATION_MAPPING_MISSING',
          });
        return { blocked: String(row.credit_movement_id) };
      }

      const frozen = {
        ...row,
        request_inventory_item_gid: `gid://shopify/InventoryItem/${identity.external_inventory_item_id}`,
        request_location_gid: `gid://shopify/Location/${location.external_location_id}`,
      };
      patch.request_inventory_item_gid = frozen.request_inventory_item_gid;
      patch.request_location_gid = frozen.request_location_gid;
      patch.request_payload_sha256 = requestSha256(buildRequest(frozen));
      patch.request_frozen_at = trx.fn.now();
    }

    if (row.status === 'blocked_mapping' || row.status === 'blocked_credential') {
      patch.status = 'pending';
    }

    const [claimed] = await trx(RECOVERY_SYNCS)
      .where({ shop_id: shopId, credit_movement_id: row.credit_movement_id })
      .update(patch)
      .returning('*');

    return { token, row: claimed };
  });
}

async function fencedUpdate(
  shopId: number,
  claim: Claim,
  patch: (trx: Knex.Transaction) => Record<string, unknown>,
  extra?: (query: Knex.QueryBuilder, trx: Knex.Transaction) => void
): Promise<any | undefined> {
  return withTenant(shopId, async (trx) => {
    const query = trx(RECOVERY_SYNCS)
      .where({ shop_id: shopId, credit_movement_id: claim.row.credit_movement_id, lease_token: claim.token });
    extra?.(query, trx);
    const [row] = await query.update(patch(trx)).returning('*');
    return row;
  });
}

export async function dispatchNextRecoveryCredit(
  shopId: number,
  deps: ShopifyRecoveryInventorySyncDeps = {}
): Promise<DispatchOutcome> {
  const claimed = await claimNext(shopId);
  if (!claimed) return { kind: 'IDLE' };
  if ('blocked' in claimed) return { kind: 'BLOCKED_MAPPING', creditMovementId: claimed.blocked };

  const creditMovementId = String(claimed.row.credit_movement_id);
  const request = buildRequest(claimed.row);
  if (requestSha256(request) !== claimed.row.request_payload_sha256) {
    throw new Error('[RECOVERY_SYNC] frozen request integrity check failed');
  }

  // Credential I/O outside any transaction; failure never calls Shopify.
  const credential = await resolveShopifyAdminCredentialForConsumer({ shopId, now: new Date() });
  if (credential.kind !== 'READY') {
    const terminal = credential.kind === 'REAUTH_REQUIRED' || credential.kind === 'PROVIDER_REJECTED';
    await fencedUpdate(shopId, claimed, (trx) => ({
      ...(terminal && claimed.row.status === 'pending' ? { status: 'blocked_credential' } : {}),
      last_attempt_at: trx.fn.now(),
      last_error: `CREDENTIAL_${credential.kind}`,
      lease_token: null,
      lease_expires_at: null,
    }));
    return { kind: terminal ? 'BLOCKED_CREDENTIAL' : 'CREDENTIAL_RETRY', creditMovementId };
  }

  // Durable dispatch identity BEFORE provider I/O (0228 enforces the 23-hour
  // cutoff and the baseline proof on this transition).
  const dispatching = await fencedUpdate(
    shopId,
    claimed,
    (trx) => ({
      status: 'dispatching',
      first_dispatched_at: trx.raw('COALESCE(first_dispatched_at, now())'),
      attempt_count: trx.raw('attempt_count + 1'),
      last_attempt_at: trx.fn.now(),
      lease_expires_at: trx.raw(`now() + interval '${LEASE_SECONDS} seconds'`),
    }),
    (query, trx) => {
      query.whereIn('status', ['pending', 'ambiguous']).where('lease_expires_at', '>', trx.fn.now());
    }
  );
  if (!dispatching) return { kind: 'FENCED', creditMovementId };

  const createClient =
    deps.createShopifyGraphQLClient ??
    ((await import('../shopify/shopifyClient.service.js')).createShopifyGraphQLClient as unknown as NonNullable<
      ShopifyRecoveryInventorySyncDeps['createShopifyGraphQLClient']
    >);
  const client = createClient({
    accessToken: credential.accessToken,
    platformShopName: credential.shopDomain,
    shopId,
  });

  let response: any;
  try {
    response = await client.request(RECOVERY_INVENTORY_ADJUST_MUTATION, {
      variables: request,
    });
  } catch (error) {
    const recorded = await fencedUpdate(shopId, claimed, () => ({
      status: 'ambiguous',
      last_error: errorText(error),
      lease_token: null,
      lease_expires_at: null,
    }));
    console.warn('[RECOVERY_SYNC_AMBIGUOUS]', { shopId, creditMovementId });
    return { kind: recorded ? 'AMBIGUOUS' : 'FENCED', creditMovementId };
  }

  const payload = response?.data?.inventoryAdjustQuantities;
  const userErrors = Array.isArray(payload?.userErrors) ? payload.userErrors : null;
  const groupId = payload?.inventoryAdjustmentGroup?.id;

  if (userErrors && userErrors.length > 0) {
    const recorded = await fencedUpdate(shopId, claimed, () => ({
      status: 'rejected',
      last_error: JSON.stringify(userErrors).slice(0, 500),
      lease_token: null,
      lease_expires_at: null,
    }));
    console.error('[RECOVERY_SYNC_REJECTED]', { shopId, creditMovementId });
    return { kind: recorded ? 'REJECTED' : 'FENCED', creditMovementId };
  }

  if (userErrors && typeof groupId === 'string' && groupId.length > 0) {
    const recorded = await fencedUpdate(shopId, claimed, () => ({
      status: 'succeeded',
      provider_adjustment_group_gid: groupId,
      last_error: null,
      lease_token: null,
      lease_expires_at: null,
    }));
    console.info('[RECOVERY_SYNC_SUCCEEDED]', { shopId, creditMovementId });
    // Fenced out: a reclaimer owns the row and retries the identical key.
    return { kind: recorded ? 'SUCCEEDED' : 'FENCED', creditMovementId };
  }

  const recorded = await fencedUpdate(shopId, claimed, () => ({
    status: 'ambiguous',
    last_error: 'UNRECOGNISED_PROVIDER_RESPONSE',
    lease_token: null,
    lease_expires_at: null,
  }));
  return { kind: recorded ? 'AMBIGUOUS' : 'FENCED', creditMovementId };
}

export async function runShopifyRecoveryInventorySyncForShop(
  shopId: number,
  deps: ShopifyRecoveryInventorySyncDeps = {}
): Promise<DispatchOutcome[]> {
  await sweepRecoveryCredits(shopId);
  const outcomes: DispatchOutcome[] = [];
  for (let i = 0; i < MAX_DISPATCHES_PER_SHOP_RUN; i += 1) {
    const outcome = await dispatchNextRecoveryCredit(shopId, deps);
    if (outcome.kind === 'IDLE') break;
    outcomes.push(outcome);
  }
  return outcomes;
}
