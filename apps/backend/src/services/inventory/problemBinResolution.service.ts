import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { lockStowDestinationHierarchy, assertStowDestinationEligible } from '../wms/stowDestinationEligibility.service.js';
import { assertStowLocationCapacity, isLocationCapacityEnforced } from '../wms/stowLocationCapacity.service.js';
import { resolveLocationIdentity } from '../wms/locationIdentity.service.js';
import { problemBinError } from './problemBinQuarantine.service.js';
export { QUARANTINE_REASONS, type QuarantineReason } from './problemBinQuarantine.service.js';
import { ACTION_ROLE_MAP } from '../permissions/permissionPolicy.js';
import { writeAuditLog } from '../audit/operatorAudit.service.js';
import { enqueueShopSnapshotJob } from '../shop-snapshot/enqueueShopSnapshotJob.js';

/**
 * SF-PROBLEM-BIN Phase B S2 — the ONE Problem Bin resolution writer.
 * ------------------------------------------------------------------
 * Resolves a Phase A quarantine incident (source 'warehouse', type
 * 'quarantined_unit') by direct barcode scan: Problem Bin → exact LSU →
 * destination. Never through the generic GH-1238 path (default-deny there).
 *
 *   release    Problem Bin −1 / destination +1 (two location_transfer legs),
 *              unit quarantined → stowed at the destination, incident resolved
 *              (resolution_action 'release_to_stock'). On-hand conserved.
 *   write_off  Problem Bin −1 (one 'damage' movement), unit → 'written_off'
 *              with no location, incident resolved ('write_off').
 *              Damaged / defective only; missing units are S3.
 *
 * Authority (decided here, re-proved by the 0232 event trigger):
 *   management      the actor's active role holds the LOCKED
 *                   wms:problem:resolve (owner/admin): release or write off.
 *   problem_solver  an active operator with an active per-member designation:
 *                   release ONLY, and only a unit quarantined as 'routine'.
 *
 * Truth rows are written in canonical projection form
 * (available = max(0, on_hand − reserved)) so rebuildInventoryProjection
 * reproduces them; both legs and the damage debit are rebuild movement types.
 * No Shopify call (S4).
 *
 * Lock order (matches quarantine / confirmStow): shop hierarchy advisory lock →
 * replay lookup → unit FOR UPDATE → incident FOR UPDATE → membership/designation
 * FOR SHARE → inventory_truth rows (sorted). Caller owns the transaction, tenant
 * GUC and projection GUC. Not gated by PROBLEM_BIN_QUARANTINE_ENABLED: units
 * already in custody must stay resolvable even if quarantine is switched off.
 */

const NS = 'b1d6c0de-5e2a-4b8f-8c3a-0f4e7d9a2c61';
const OPEN_STATUSES = ['open', 'investigating'];
export const WRITE_OFF_REASONS = ['damaged', 'defective'] as const;
export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];
const MANAGEMENT_ROLES = ACTION_ROLE_MAP['wms:problem:resolve'];
/** D-3: release lands in a pick or storage bin. Unlike Receive recovery, an
 * unzoned (NULL) legacy bin is not accepted: D-3 named storage zones only. */
const RELEASE_DESTINATION_ZONES = ['pick', 'storage'];

export type ProblemBinResolutionInput = {
  shopId: number;
  actorId: number;
  problemTaskId: string;
  problemBinScan: string;
  unitScan: string;
  deviceEventId: string;
  notes?: string | null;
} & (
  | { action: 'release'; destinationScan: string }
  | { action: 'write_off'; writeOffReason: WriteOffReason }
);

type Authority = 'management' | 'problem_solver';

async function resolveAuthority(
  trx: Knex.Transaction, shopId: number, actorId: number, action: 'release' | 'write_off', custodyReason: string | null
): Promise<Authority> {
  const membership = await trx('shop_memberships')
    .where({ shop_id: shopId, user_id: actorId }).whereNull('revoked_at').forShare().first('role');
  if (!membership) throw problemBinError('PROBLEM_BIN_RESOLUTION_FORBIDDEN', 403);
  if (MANAGEMENT_ROLES.includes(membership.role)) return 'management';
  if (action !== 'release' || membership.role !== 'operator') throw problemBinError('PROBLEM_BIN_RESOLUTION_FORBIDDEN', 403);
  const designation = await trx('problem_solver_designations')
    .where({ shop_id: shopId, user_id: actorId }).whereNull('revoked_at').forShare().first('designation_id');
  if (!designation) throw problemBinError('PROBLEM_BIN_RESOLUTION_FORBIDDEN', 403);
  if (custodyReason !== 'routine') {
    throw problemBinError('PROBLEM_BIN_RESOLUTION_REQUIRES_MANAGEMENT', 403,
      'This unit was quarantined as damaged or defective — an owner or admin must decide it');
  }
  return 'problem_solver';
}

/** Scan → location row (code or barcode, ambiguity refused), this shop only. */
async function scannedLocation(trx: Knex.Transaction, shopId: number, scan: string) {
  return resolveLocationIdentity(trx, shopId, scan);
}

export async function resolveProblemBinIncident(trx: Knex.Transaction, input: ProblemBinResolutionInput) {
  const { shopId, actorId, problemTaskId, problemBinScan, unitScan, deviceEventId, action } = input;
  const notes = input.notes?.trim() || null;
  const destinationScan = input.action === 'release' ? input.destinationScan : null;
  const writeOffReason = input.action === 'write_off' ? input.writeOffReason : null;
  const outcome = action === 'release' ? 'released' : 'written_off';

  await lockStowDestinationHierarchy(trx, shopId);

  // Replay authority first (same event → its committed result, even though the
  // incident is now closed).
  const prior = await trx('problem_bin_resolution_events').where({ shop_id: shopId, device_event_id: deviceEventId }).first();
  if (prior) {
    if (prior.problem_task_id !== problemTaskId || prior.outcome !== outcome || prior.operator_id !== actorId ||
        prior.problem_bin_scan !== problemBinScan || prior.unit_scan !== unitScan ||
        (prior.destination_scan ?? null) !== destinationScan || (prior.write_off_reason ?? null) !== writeOffReason) {
      throw problemBinError('PROBLEM_BIN_REPLAY_CONFLICT');
    }
    return { ...prior.result, replayed: true };
  }

  // Unlocked identity read, then unit → incident locks, then revalidate.
  const identity = await trx('problem_center_tasks')
    .where({ shop_id: shopId, problem_task_id: problemTaskId, source: 'warehouse', exception_type: 'quarantined_unit' })
    .first('lasyncro_unit_id');
  if (!identity?.lasyncro_unit_id) throw problemBinError('PROBLEM_BIN_INCIDENT_NOT_FOUND', 404);
  const lsu: string = identity.lasyncro_unit_id;
  // Exact-LSU verification: the scanned label must be this incident's unit.
  if (unitScan !== lsu) throw problemBinError('PROBLEM_BIN_UNIT_SCAN_MISMATCH');

  const unit = await trx('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: lsu }).forUpdate()
    .first('lasyncro_unit_id', 'lasyncro_variant_id', 'status', 'current_location_code');
  const task = await trx('problem_center_tasks').where({ shop_id: shopId, problem_task_id: problemTaskId }).forUpdate()
    .first('status', 'lasyncro_unit_id', 'lasyncro_variant_id', 'problem_bin_location');
  if (!unit || !task) throw problemBinError('PROBLEM_BIN_INCIDENT_NOT_FOUND', 404);
  if (!OPEN_STATUSES.includes(task.status)) throw problemBinError('PROBLEM_BIN_INCIDENT_NOT_OPEN');

  const custody = await trx('problem_bin_custody_events')
    .where({ shop_id: shopId, problem_task_id: problemTaskId, lasyncro_unit_id: lsu }).first('problem_bin_location', 'quarantine_reason');
  if (!custody || unit.status !== 'quarantined' || unit.current_location_code !== task.problem_bin_location ||
      custody.problem_bin_location !== task.problem_bin_location || unit.lasyncro_variant_id !== task.lasyncro_variant_id) {
    throw problemBinError('PROBLEM_BIN_CUSTODY_MISMATCH');
  }
  const bin: string = task.problem_bin_location;

  // Verified custody: the scanned Problem Bin must be the bin holding the unit
  // (active or since deactivated — deactivation never strands custody).
  const scannedBin = await scannedLocation(trx, shopId, problemBinScan);
  if (scannedBin?.location_code !== bin) throw problemBinError('PROBLEM_BIN_SCAN_MISMATCH');

  const authority = await resolveAuthority(trx, shopId, actorId, action, custody.quarantine_reason ?? null);

  let destination: string | null = null;
  if (input.action === 'release') {
    const dest = await scannedLocation(trx, shopId, input.destinationScan);
    if (!dest) throw problemBinError('PROBLEM_BIN_DESTINATION_INELIGIBLE');
    // Eligible stock location (owner decision D-3, ratified): an active leaf bin
    // in a pick OR storage zone, the Receive-recovery destination rule. Never
    // the warehouse root, a staging/exception zone, or a designated Problem Bin.
    // Physical vs pickable: a storage credit is physical on-hand at that row but
    // not pickable — availability readers apply pickableLocationCondition
    // (pick bins + root). The truth row stays zone-agnostic (canonical
    // projection form), which is what rebuild reproduces.
    const eligible = await trx('warehouse_locations as wl')
      .where({ 'wl.shop_id': shopId, 'wl.location_code': dest.location_code, 'wl.active': true, 'wl.type': 'bin' })
      .whereIn('wl.zone_type', RELEASE_DESTINATION_ZONES).first('wl.location_code');
    if (!eligible || dest.location_code === bin) throw problemBinError('PROBLEM_BIN_DESTINATION_INELIGIBLE');
    const settings = await trx('shop_wms_settings').where({ shop_id: shopId }).first('problem_bin_location');
    if (settings?.problem_bin_location === dest.location_code) throw problemBinError('PROBLEM_BIN_DESTINATION_INELIGIBLE');
    await assertStowDestinationEligible(trx, shopId, dest.location_code);
    destination = dest.location_code;
  }

  const variantId: string = unit.lasyncro_variant_id;
  const now = new Date();
  await trx('inventory_truth').where({ shop_id: shopId, lasyncro_variant_id: variantId })
    .whereIn('location_code', destination ? [bin, destination] : [bin]).orderBy('location_code').forUpdate().select('location_code');
  if (destination) {
    await assertStowLocationCapacity(trx, {
      shopId, locationCode: destination, incomingQuantity: 1, enforced: await isLocationCapacityEnforced(trx, shopId),
    });
  }

  // Debit exactly this unit from its Problem Bin row (canonical form).
  const debit = await trx('inventory_truth')
    .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: bin })
    .where('on_hand_quantity', '>=', 1)
    .update({
      on_hand_quantity: trx.raw('on_hand_quantity - 1'),
      available_quantity: trx.raw('GREATEST(0, on_hand_quantity - 1 - reserved_quantity)'),
      updated_at: now, last_evaluated_at: now,
    });
  if (debit !== 1) throw problemBinError('PROBLEM_BIN_STOCK_MISSING');
  if (destination) {
    await trx('inventory_truth').insert({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: destination,
      on_hand_quantity: 1, available_quantity: 1, reserved_quantity: 0, committed_quantity: 0, last_evaluated_at: now })
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code']).merge({
        on_hand_quantity: trx.raw('inventory_truth.on_hand_quantity + 1'),
        available_quantity: trx.raw('GREATEST(0, inventory_truth.on_hand_quantity + 1 - inventory_truth.reserved_quantity)'),
        updated_at: now, last_evaluated_at: now });
  }

  const resolutionId = uuidv5(`${shopId}:${deviceEventId}:problem-bin-resolution`, NS);
  const legs: Array<[string, string, number, string]> = destination
    ? [['debit', bin, -1, 'location_transfer'], ['credit', destination, 1, 'location_transfer']]
    : [['damage', bin, -1, 'damage']];
  for (const [leg, location, delta, movementType] of legs) {
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: uuidv5(`${resolutionId}:${leg}:movement`, NS),
      device_event_id: uuidv5(`${resolutionId}:${leg}:device`, NS), shop_id: shopId, lasyncro_variant_id: variantId,
      movement_type: movementType, quantity_delta: delta, location_code: location,
      reference_type: destination ? 'problem_bin_release' : 'problem_bin_write_off', reference_id: resolutionId,
      platform: 'wms', triggered_by: 'problem_bin', operator_id: actorId, occurred_at: now });
  }

  const resolutionAction = destination ? 'release_to_stock' : 'write_off';
  const result = {
    resolution_id: resolutionId, problem_task_id: problemTaskId, lasyncro_unit_id: lsu, outcome,
    resolution_action: resolutionAction, problem_bin_location: bin, destination_location: destination,
    write_off_reason: writeOffReason, authority, unit_status: destination ? 'stowed' : 'written_off',
  };

  // Evidence precedes the unit and incident transitions: the 0232 guards require it.
  await trx('problem_bin_resolution_events').insert({
    shop_id: shopId, device_event_id: deviceEventId, resolution_id: resolutionId, problem_task_id: problemTaskId,
    lasyncro_unit_id: lsu, outcome, problem_bin_location: bin, problem_bin_scan: problemBinScan, unit_scan: unitScan,
    destination_location: destination, destination_scan: destinationScan, write_off_reason: writeOffReason,
    authority, operator_id: actorId, notes, result });
  await trx('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: lsu }).update({
    status: destination ? 'stowed' : 'written_off', current_location_code: destination,
    quarantined_from_location: null, quarantined_from_status: null, updated_at: now });
  await trx('problem_center_tasks').where({ shop_id: shopId, problem_task_id: problemTaskId }).update({
    status: 'resolved', resolution_action: resolutionAction, resolution_notes: notes,
    resolved_by: actorId, resolved_at: now, updated_at: now });

  await writeAuditLog(trx, { shopId, operatorId: actorId,
    actionType: destination ? 'problem_bin_release' : 'problem_bin_write_off',
    entityType: 'inventory_unit', entityId: lsu, metadata: result });
  await enqueueShopSnapshotJob(trx, shopId);
  return { ...result, replayed: false };
}

// ── Per-member problem-solver designation ────────────────────────────────

/** Caller must hold wms:problem:resolve (route). Target: an active operator. */
export async function grantProblemSolver(trx: Knex.Transaction, input: { shopId: number; actorId: number; userId: number }) {
  const { shopId, actorId, userId } = input;
  const member = await trx('shop_memberships').where({ shop_id: shopId, user_id: userId }).whereNull('revoked_at')
    .forShare().first('role');
  if (!member) throw problemBinError('PROBLEM_SOLVER_TARGET_NOT_MEMBER', 404);
  if (member.role !== 'operator') {
    throw problemBinError('PROBLEM_SOLVER_TARGET_NOT_OPERATOR', 409,
      'Owners and admins already resolve problems; designate an operator');
  }
  const existing = await trx('problem_solver_designations').where({ shop_id: shopId, user_id: userId })
    .whereNull('revoked_at').first('designation_id', 'granted_at', 'granted_by');
  if (existing) return { ...existing, user_id: userId, created: false };
  const [row] = await trx('problem_solver_designations')
    .insert({ shop_id: shopId, user_id: userId, granted_by: actorId })
    .onConflict(trx.raw('(shop_id, user_id) WHERE revoked_at IS NULL')).ignore()
    .returning(['designation_id', 'granted_at', 'granted_by']);
  const designation = row ?? await trx('problem_solver_designations').where({ shop_id: shopId, user_id: userId })
    .whereNull('revoked_at').first('designation_id', 'granted_at', 'granted_by');
  if (row) {
    await writeAuditLog(trx, { shopId, operatorId: actorId, actionType: 'problem_solver_grant',
      entityType: 'problem_solver_designation', entityId: String(userId), metadata: { designation_id: row.designation_id } });
  }
  return { ...designation, user_id: userId, created: Boolean(row) };
}

export async function revokeProblemSolver(trx: Knex.Transaction, input: { shopId: number; actorId: number; userId: number }) {
  const { shopId, actorId, userId } = input;
  const now = new Date();
  const rows = await trx('problem_solver_designations').where({ shop_id: shopId, user_id: userId }).whereNull('revoked_at')
    .update({ revoked_at: now, revoked_by: actorId }).returning(['designation_id']);
  if (rows.length > 0) {
    await writeAuditLog(trx, { shopId, operatorId: actorId, actionType: 'problem_solver_revoke',
      entityType: 'problem_solver_designation', entityId: String(userId), metadata: { designation_id: rows[0].designation_id } });
  }
  return { user_id: userId, revoked: rows.length > 0 };
}

export async function listProblemSolvers(trx: Knex.Transaction, shopId: number) {
  return trx('problem_solver_designations as d')
    .join('shop_memberships as m', function () {
      this.on('m.shop_id', '=', 'd.shop_id').andOn('m.user_id', '=', 'd.user_id');
    })
    .where('d.shop_id', shopId).whereNull('d.revoked_at').whereNull('m.revoked_at')
    .orderBy('d.granted_at', 'asc')
    .select('d.user_id', 'd.designation_id', 'd.granted_by', 'd.granted_at', 'm.role');
}
