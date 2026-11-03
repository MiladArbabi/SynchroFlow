// apps/backend/src/services/wms/receiveRecoverySyncEligibility.service.ts
//
// SF-RECEIVE-PC-RELEASE-SAFETY-015 — canonical per-shop eligibility for Receive
// recovery (contract SF-RECEIVE-PC-RELEASE-SAFETY-014, owner decisions on 015).
//
// A recovery credit (I3) raises LaSyncro truth; Shopify follows only through
// the I4 push. A recovery is therefore approved only when that push can
// actually run for the shop (owner decision 015/C4: no exception for shops
// without Shopify — every FT2 shop is Shopify-linked, and any other state
// fails closed):
//
//   connection not ready (not installed, integration-only, uninstalled,
//   reauthentication required, reconnecting)                   → refused
//   sync flag OFF                                                → refused
//   no converged + captured baseline (I4 readRecoveryBaseline)   → refused
//   variant without a Shopify inventory item                     → refused
//
// Destination scope (assignment and confirmation): the recovery bin must sit
// in the baseline warehouse and that warehouse must map to a Shopify
// location; otherwise the operator chooses another bin.
//
// D1: the sync flag is a dispatch kill switch, not a credit-validity rule. It
// gates new approvals only; an approved recovery Stow may still confirm, and
// its credit waits durably for I4 (lag, not loss).
//
// Pure tenant-scoped reads inside the caller's transaction: no locks, no
// writes, no decryption and no provider I/O. Worker health, pending age and
// blocked / rejected / held_expired rows are operational monitoring, not this
// gate (D2 deferred with I4 MEDIUM-2).

import type { Knex } from 'knex';

import { classifyShopifyConnection, type ShopifyConnectionState } from '../shopify/shopifyConnectionState.service.js';
import { isShopifyRecoveryInventorySyncEnabled } from '../../workers/shopifyRecoveryInventorySync.worker.js';
import { readRecoveryBaseline } from './shopifyRecoveryInventorySync.service.js';

export type RecoverySyncUnavailableReason =
  | 'SHOPIFY_NOT_CONNECTED'
  | 'SHOPIFY_DISCONNECTED'
  | 'SYNC_DISABLED'
  | 'NO_CONVERGED_CUTOVER'
  | 'MARKER_WITHOUT_CONVERGED_GENERATION'
  | 'BASELINE_WITHOUT_RECOVERY_CAPTURE'
  | 'VARIANT_NOT_MAPPED';

export type RecoverySyncEligibility =
  | { available: true; reason: null; baselineWarehouseId: string }
  | { available: false; reason: RecoverySyncUnavailableReason };

export const RECOVERY_SYNC_UNAVAILABLE = 'RECEIVE_RECOVERY_SYNC_UNAVAILABLE';

const DISCONNECTED_STATES: ReadonlySet<ShopifyConnectionState> = new Set([
  'UNINSTALLED',
  'UNINSTALL_VERIFICATION_UNRESOLVED',
]);

/** Approval-time eligibility for one shop (and, when given, one variant). */
export async function evaluateRecoverySyncEligibility(
  trx: Knex.Transaction,
  shopId: number,
  options: { variantId?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<RecoverySyncEligibility> {
  const refuse = (reason: RecoverySyncUnavailableReason): RecoverySyncEligibility => ({ available: false, reason });

  // GH-1101 canonical connection state; NOT_INSTALLED (incl. legacy
  // integration-only shops) and every non-ready state fail closed.
  const connection = await classifyShopifyConnection(trx, shopId);
  if (!connection.connected) {
    return refuse(DISCONNECTED_STATES.has(connection.state) ? 'SHOPIFY_DISCONNECTED' : 'SHOPIFY_NOT_CONNECTED');
  }
  if (!isShopifyRecoveryInventorySyncEnabled(options.env)) return refuse('SYNC_DISABLED');

  const baseline = await readRecoveryBaseline(trx, shopId);
  if (baseline.kind === 'held') return refuse(baseline.holdReason);

  if (options.variantId !== undefined) {
    const identity = await trx('external_product_identity_map')
      .where({ shop_id: shopId, lasyncro_variant_id: options.variantId })
      .first('external_inventory_item_id');
    if (!identity?.external_inventory_item_id) return refuse('VARIANT_NOT_MAPPED');
  }

  return { available: true, reason: null, baselineWarehouseId: baseline.warehouseId };
}

export type RecoveryDestinationSyncRefusal =
  | 'outside_sync_baseline_warehouse'
  | 'location_not_mapped'
  | 'sync_baseline_unavailable';

/**
 * Destination-scoped check at recovery Stow assignment and again at
 * confirmation. Deliberately independent of the connection and the flag (D1):
 * it refuses only bins whose credit the I4 classifier could never push
 * (WAREHOUSE_NOT_IN_BASELINE) or freeze (LOCATION_MAPPING_MISSING). Every
 * refusal is recoverable by choosing another bin.
 *
 * 'sync_baseline_unavailable' fails closed. It cannot arise for a recovery
 * approved after SAFETY-015 (approval requires the baseline; the marker is
 * never cleared and 'converged' is final). It is NOT a guarantee for recovery
 * Stows created before this guard existed: such a Stow without a baseline
 * would be refused here at assignment and confirmation. None exists in
 * production (SAFETY-015 HIGH-1 evidence: production at migration 0222 has no
 * 'receive_recovery' stow_task_trigger label, so no such row can exist, and
 * 0223–0228 write no stow_tasks rows); the guard ships in the same release.
 */
export async function recoveryDestinationSyncRefusal(
  trx: Knex.Transaction,
  shopId: number,
  destination: string
): Promise<RecoveryDestinationSyncRefusal | null> {
  const baseline = await readRecoveryBaseline(trx, shopId);
  if (baseline.kind === 'held') return 'sync_baseline_unavailable';

  const location = await trx('warehouse_locations as wl')
    .join('warehouses as w', function joinWarehouse() {
      this.on('w.warehouse_id', '=', 'wl.warehouse_id').andOn('w.shop_id', '=', 'wl.shop_id');
    })
    .where({ 'wl.shop_id': shopId, 'wl.location_code': destination })
    .first('wl.warehouse_id', 'w.external_location_id');
  if (!location || String(location.warehouse_id) !== baseline.warehouseId) {
    return 'outside_sync_baseline_warehouse';
  }
  if (!location.external_location_id) return 'location_not_mapped';
  return null;
}
