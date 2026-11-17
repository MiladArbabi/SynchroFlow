import type { Knex } from 'knex';
import { writeAuditLog } from '../audit/operatorAudit.service.js';
import { isActionAllowed } from '../permissions/permissionCache.service.js';

/**
 * SF-PICK-ASSIGN-01 — Pick ownership transitions.
 * ------------------------------------------------
 * Single owner of every Pick ownership change: claim (first-to-claim and idle
 * takeover), owner/admin assignment and reassignment, assignment expiry and
 * custody acknowledgement. It also owns the fence that every consequential
 * Pick write (scan, pick-stage exception, completion) must pass.
 *
 * Columns:
 *   assigned_operator_id   who the work is reserved for (NULL = first to claim)
 *   pick_assigned_at       expiry clock for that reservation
 *   picked_by              custody — the only operator whose writes may commit
 *   pick_claim_generation  rotated on every new claim / takeover; a write must
 *                          present the current value, so a revoked session
 *                          (including A → B → A) can never commit
 *   pick_custody_ack_required  set by a takeover of a batch with picked units;
 *                          writes are refused until the new owner acknowledges
 *
 * Lock order (canonical, shared with confirmPickScan and the exception route):
 *   orders (sorted by lasyncro_order_id) FOR UPDATE → pick_batches FOR UPDATE.
 *
 * Transitions never touch inventory, movements, scans, allocations or
 * reservations: picked units are bound to the batch, not the operator.
 */

export const DEFAULT_PICK_RECOVERY_THRESHOLD_MINUTES = 30;

export type PickOwnershipErrorCode =
  | 'PICK_BATCH_NOT_FOUND'
  | 'PICK_ALREADY_CLAIMED'
  | 'PICK_ASSIGNED_TO_OTHER'
  | 'PICK_NOT_CLAIMABLE'
  | 'PICK_NOT_IDLE'
  | 'PICK_NOT_REASSIGNABLE'
  | 'PICK_BATCH_NOT_PICKING'
  | 'PICK_OWNERSHIP_REVOKED'
  | 'PICK_GENERATION_REQUIRED'
  | 'PICK_GENERATION_STALE'
  | 'PICK_CUSTODY_ACK_REQUIRED'
  | 'PICK_CUSTODY_ACK_NOT_REQUIRED'
  | 'INVALID_PICK_ASSIGNEE';

const STATUS_BY_CODE: Record<PickOwnershipErrorCode, number> = {
  PICK_BATCH_NOT_FOUND: 404,
  PICK_ALREADY_CLAIMED: 409,
  PICK_ASSIGNED_TO_OTHER: 409,
  PICK_NOT_CLAIMABLE: 409,
  PICK_NOT_IDLE: 409,
  PICK_NOT_REASSIGNABLE: 409,
  PICK_BATCH_NOT_PICKING: 409,
  PICK_OWNERSHIP_REVOKED: 409,
  PICK_GENERATION_REQUIRED: 409,
  PICK_GENERATION_STALE: 409,
  PICK_CUSTODY_ACK_REQUIRED: 409,
  PICK_CUSTODY_ACK_NOT_REQUIRED: 409,
  INVALID_PICK_ASSIGNEE: 400,
};

const DEFAULT_MESSAGE: Record<PickOwnershipErrorCode, string> = {
  PICK_BATCH_NOT_FOUND: 'Batch not found',
  PICK_ALREADY_CLAIMED: 'Batch already claimed by another operator',
  PICK_ASSIGNED_TO_OTHER: 'Batch is assigned to another operator',
  PICK_NOT_CLAIMABLE: 'Batch is not claimable',
  PICK_NOT_IDLE: 'Batch is not idle long enough to recover',
  PICK_NOT_REASSIGNABLE: 'Batch cannot be reassigned in its current state',
  PICK_BATCH_NOT_PICKING: 'Batch is not in picking status',
  PICK_OWNERSHIP_REVOKED: 'Batch owned by different operator',
  PICK_GENERATION_REQUIRED: 'pick_claim_generation is required; claim or resume the batch first',
  PICK_GENERATION_STALE: 'This Pick session is no longer current; resume the batch to continue',
  PICK_CUSTODY_ACK_REQUIRED: 'Confirm you have the picked items before continuing',
  PICK_CUSTODY_ACK_NOT_REQUIRED: 'No custody acknowledgement is pending for this batch',
  INVALID_PICK_ASSIGNEE: 'INVALID_PICK_ASSIGNEE',
};

export class PickOwnershipError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: PickOwnershipErrorCode,
    message?: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = 'PickOwnershipError';
    this.statusCode = STATUS_BY_CODE[code];
  }
}

export type LockedPickBatch = {
  pick_batch_id: string;
  status: string;
  picked_by: number | null;
  assigned_operator_id: number | null;
  pick_assigned_at: Date | null;
  pick_claim_generation: string | null;
  pick_custody_ack_required: boolean;
  units_picked: number;
  /** Minutes since the last Pick activity (claim or confirmed work); DB clock. */
  idle_minutes: number | null;
  /** Minutes since the current assignment was made; DB clock. */
  assignment_age_minutes: number | null;
};

/** Post-commit notification intents; the caller dispatches them after commit. */
export type PickNotificationIntent =
  | { kind: 'user'; userId: number; title: string; body: string; batchId: string }
  | { kind: 'operators'; title: string; body: string; batchId: string };

const short = (batchId: string) => batchId.slice(0, 8).toUpperCase();

/**
 * Locks the lifecycle anchors in canonical order and returns the batch row.
 * Returns null when the batch does not exist in this tenant.
 */
export async function lockPickBatch(
  trx: Knex.Transaction,
  shopId: number,
  batchId: string
): Promise<LockedPickBatch | null> {
  const orderIds = await trx('pick_batch_orders')
    .where({ pick_batch_id: batchId, shop_id: shopId })
    .pluck('lasyncro_order_id');
  if (orderIds.length > 0) {
    await trx('orders')
      .where({ shop_id: shopId })
      .whereIn('lasyncro_order_id', orderIds)
      .orderBy('lasyncro_order_id', 'asc')
      .forUpdate()
      .select('lasyncro_order_id');
  }
  return lockPickBatchRow(trx, shopId, batchId);
}

/** Batch row lock only — for callers that already hold their order anchor. */
export async function lockPickBatchRow(
  trx: Knex.Transaction,
  shopId: number,
  batchId: string
): Promise<LockedPickBatch | null> {
  const row = await trx('pick_batches')
    .where({ pick_batch_id: batchId, shop_id: shopId })
    .forUpdate()
    .first(
      'pick_batch_id',
      'status',
      'picked_by',
      'assigned_operator_id',
      'pick_assigned_at',
      'pick_claim_generation',
      'pick_custody_ack_required',
      'units_picked',
      trx.raw(
        `EXTRACT(EPOCH FROM (now() - COALESCE(pick_last_activity_at, pick_claimed_at))) / 60.0 AS idle_minutes`
      ),
      trx.raw(
        `EXTRACT(EPOCH FROM (now() - pick_assigned_at)) / 60.0 AS assignment_age_minutes`
      )
    );
  if (!row) return null;
  return {
    ...row,
    units_picked: Number(row.units_picked ?? 0),
    idle_minutes: row.idle_minutes == null ? null : Number(row.idle_minutes),
    assignment_age_minutes:
      row.assignment_age_minutes == null ? null : Number(row.assignment_age_minutes),
  };
}

/**
 * Effective recovery threshold for a batch.
 * Allocation-backed: the MAX threshold across every warehouse its allocations
 * resolve to (approved contract). Legacy (no allocations): the shop's default
 * warehouse. No warehouse at all: 30.
 */
export function pickRecoveryThresholdSql(batchAlias: string): string {
  if (!/^[a-z_]+$/.test(batchAlias)) throw new Error('invalid alias');
  return `COALESCE(
    (SELECT MAX(w.pick_recovery_threshold_minutes)
       FROM pick_reservation_allocations pra
       JOIN warehouse_locations wl
         ON wl.shop_id = pra.shop_id AND wl.location_code = pra.location_code
       JOIN warehouses w ON w.warehouse_id = wl.warehouse_id
      WHERE pra.shop_id = ${batchAlias}.shop_id
        AND pra.pick_batch_id = ${batchAlias}.pick_batch_id),
    (SELECT wd.pick_recovery_threshold_minutes
       FROM warehouses wd
      WHERE wd.shop_id = ${batchAlias}.shop_id AND wd.is_default = true
      LIMIT 1),
    ${DEFAULT_PICK_RECOVERY_THRESHOLD_MINUTES}
  )`;
}

export async function resolvePickRecoveryThresholdMinutes(
  trx: Knex.Transaction,
  shopId: number,
  batchId: string
): Promise<number> {
  const row = await trx('pick_batches as pb')
    .where({ 'pb.shop_id': shopId, 'pb.pick_batch_id': batchId })
    .first(trx.raw(`${pickRecoveryThresholdSql('pb')} AS threshold`));
  return Number(row?.threshold ?? DEFAULT_PICK_RECOVERY_THRESHOLD_MINUTES);
}

/**
 * Assignee / replacement eligibility: active member of THIS shop whose role
 * may claim and scan Pick work (same predicate as reassignRecountTask).
 */
export async function assertPickOperatorEligible(
  trx: Knex.Transaction,
  shopId: number,
  userId: unknown
): Promise<number> {
  const id = Number(userId);
  if (userId == null || !Number.isInteger(id) || id <= 0) {
    throw new PickOwnershipError('INVALID_PICK_ASSIGNEE');
  }
  const membership = await trx('shop_memberships')
    .where({ shop_id: shopId, user_id: id })
    .whereNull('revoked_at')
    .first('role');
  if (!membership) throw new PickOwnershipError('INVALID_PICK_ASSIGNEE');
  const allowed = await Promise.all(
    ['wms:batch:claim', 'wms:pick:scan'].map((action) =>
      isActionAllowed(shopId, action, membership.role)
    )
  );
  if (!allowed.every(Boolean)) throw new PickOwnershipError('INVALID_PICK_ASSIGNEE');
  return id;
}

/** An assignment to someone other than the current custodian, past its threshold. */
function assignmentExpired(batch: LockedPickBatch, thresholdMinutes: number): boolean {
  return (
    batch.assigned_operator_id !== null &&
    batch.assigned_operator_id !== batch.picked_by &&
    batch.assignment_age_minutes !== null &&
    batch.assignment_age_minutes >= thresholdMinutes
  );
}

/**
 * The fence for consequential Pick writes. The caller must hold the batch lock.
 */
export function assertPickWriteOwnership(
  batch: Pick<LockedPickBatch, 'status' | 'picked_by' | 'pick_claim_generation' | 'pick_custody_ack_required'>,
  userId: number,
  generation: unknown,
  options: { requireCustodyAck?: boolean } = {}
): void {
  if (batch.status !== 'picking') {
    throw new PickOwnershipError('PICK_BATCH_NOT_PICKING', `Batch not in picking status: ${batch.status}`, {
      status: batch.status,
    });
  }
  if (batch.picked_by !== userId) {
    throw new PickOwnershipError('PICK_OWNERSHIP_REVOKED', 'Batch owned by different operator');
  }
  if (typeof generation !== 'string' || generation.length === 0) {
    throw new PickOwnershipError('PICK_GENERATION_REQUIRED');
  }
  if (generation !== batch.pick_claim_generation) {
    throw new PickOwnershipError('PICK_GENERATION_STALE');
  }
  if ((options.requireCustodyAck ?? true) && batch.pick_custody_ack_required) {
    throw new PickOwnershipError('PICK_CUSTODY_ACK_REQUIRED');
  }
}

export type ClaimPickBatchResult = {
  pick_batch_id: string;
  status: 'picking';
  pick_claim_generation: string;
  custody_ack_required: boolean;
  units_picked: number;
  takeover: { previous_picked_by: number; idle_minutes: number; threshold_minutes: number } | null;
  notifications: PickNotificationIntent[];
};

async function transitionOrdersToPicking(
  trx: Knex.Transaction,
  shopId: number,
  batchId: string,
  now: Date
): Promise<void> {
  const batchOrders = await trx('pick_batch_orders')
    .where({ pick_batch_id: batchId })
    .select('lasyncro_order_id');

  for (const order of batchOrders) {
    await trx('order_warehouse_status')
      .insert({
        lasyncro_order_id: order.lasyncro_order_id,
        status: 'picking',
        pick_batch_id: batchId,
        status_updated_at: now,
        picked_at: null,
        packed_at: null,
        shipped_at: null,
      })
      .onConflict(['lasyncro_order_id'])
      .merge({ status: 'picking', pick_batch_id: batchId, status_updated_at: now, updated_at: now });

    const lineItems = await trx('order_line_items')
      .where({ lasyncro_order_id: order.lasyncro_order_id })
      .select('lasyncro_line_item_id', 'lasyncro_order_id');

    for (const li of lineItems) {
      await trx('order_line_item_warehouse_status')
        .insert({
          lasyncro_line_item_id: li.lasyncro_line_item_id,
          lasyncro_order_id: li.lasyncro_order_id,
          shop_id: shopId,
          status: 'picking',
          status_updated_at: now,
        })
        .onConflict(['lasyncro_line_item_id'])
        .merge({ status: 'picking', status_updated_at: now, updated_at: now });
    }
  }
}

async function resolvePreviousOwnerIdleAlert(
  trx: Knex.Transaction,
  shopId: number,
  batchId: string,
  previousOwner: number
): Promise<void> {
  await trx('alerts')
    .where({
      shop_id: shopId,
      alert_key: `wms:idle:pick:${previousOwner}`,
      entity_id: batchId,
      is_active: true,
    })
    .update({ is_active: false, dismissed_at: trx.fn.now(), updated_at: trx.fn.now() });
}

/**
 * Claim: first-to-claim for unassigned pending work, assignee-only for
 * assigned work (until it expires), and idle takeover of a claimed batch by an
 * eligible replacement once the batch has been idle for its threshold.
 */
export async function claimPickBatch(
  trx: Knex.Transaction,
  input: { shopId: number; batchId: string; userId: number; resumeOnly?: boolean }
): Promise<ClaimPickBatchResult> {
  const { shopId, batchId, userId } = input;
  const batch = await lockPickBatch(trx, shopId, batchId);
  if (!batch) throw new PickOwnershipError('PICK_BATCH_NOT_FOUND');

  // SF-PICK-RESUME-GENERATION-001 — resume-only: a fresh session of the
  // current owner recovers the EXISTING generation. Verified under the batch
  // lock; never rotates or mints a generation, never claims pending work,
  // never takes over, writes nothing.
  if (input.resumeOnly === true) {
    if (batch.status !== 'picking') {
      throw new PickOwnershipError('PICK_BATCH_NOT_PICKING', `Batch not in picking status: ${batch.status}`, {
        status: batch.status,
      });
    }
    if (batch.picked_by !== userId) throw new PickOwnershipError('PICK_OWNERSHIP_REVOKED');
    if (!batch.pick_claim_generation) throw new PickOwnershipError('PICK_GENERATION_REQUIRED');
    return {
      pick_batch_id: batchId,
      status: 'picking',
      pick_claim_generation: batch.pick_claim_generation,
      custody_ack_required: batch.pick_custody_ack_required,
      units_picked: batch.units_picked,
      takeover: null,
      notifications: [],
    };
  }

  // Same owner resuming: idempotent, no rotation.
  if (batch.status === 'picking' && batch.picked_by === userId) {
    let generation = batch.pick_claim_generation;
    if (!generation) {
      const [row] = await trx('pick_batches')
        .where({ pick_batch_id: batchId, shop_id: shopId })
        .update({ pick_claim_generation: trx.raw('gen_random_uuid()'), updated_at: trx.fn.now() })
        .returning('pick_claim_generation');
      generation = row.pick_claim_generation;
    }
    return {
      pick_batch_id: batchId,
      status: 'picking',
      pick_claim_generation: generation!,
      custody_ack_required: batch.pick_custody_ack_required,
      units_picked: batch.units_picked,
      takeover: null,
      notifications: [],
    };
  }

  if (batch.status === 'pending') {
    if (batch.picked_by !== null) throw new PickOwnershipError('PICK_ALREADY_CLAIMED');
    // C003 (REVIEW-001 L1): a new claimer must be able to claim AND scan Pick
    // work — the same eligibility contract as takeover and assignment.
    await assertPickOperatorEligible(trx, shopId, userId);
    if (batch.assigned_operator_id !== null && batch.assigned_operator_id !== userId) {
      const threshold = await resolvePickRecoveryThresholdMinutes(trx, shopId, batchId);
      if (!assignmentExpired(batch, threshold)) {
        throw new PickOwnershipError('PICK_ASSIGNED_TO_OTHER');
      }
    }

    const now = new Date();
    const [claimed] = await trx('pick_batches')
      .where({ pick_batch_id: batchId, shop_id: shopId, status: 'pending' })
      .whereNull('picked_by')
      .update({
        status: 'picking',
        picked_by: userId,
        pick_claimed_at: now,
        pick_last_activity_at: now,
        pick_claim_generation: trx.raw('gen_random_uuid()'),
        pick_custody_ack_required: false,
        updated_at: now,
      })
      .returning(['pick_claim_generation']);
    if (!claimed) throw new PickOwnershipError('PICK_ALREADY_CLAIMED');

    await transitionOrdersToPicking(trx, shopId, batchId, now);
    await writeAuditLog(trx, {
      shopId,
      operatorId: userId,
      actionType: 'pick_claim',
      entityType: 'pick_batch',
      entityId: batchId,
      metadata: {
        claimed_at: now,
        assigned_operator_id: batch.assigned_operator_id,
        pick_claim_generation: claimed.pick_claim_generation,
      },
    });
    console.info('[WMS_BATCH_CLAIMED]', { pick_batch_id: batchId, claimed_by: userId, shopId });

    return {
      pick_batch_id: batchId,
      status: 'picking',
      pick_claim_generation: claimed.pick_claim_generation,
      custody_ack_required: false,
      units_picked: batch.units_picked,
      takeover: null,
      notifications: [],
    };
  }

  if (batch.status === 'picking' && batch.picked_by !== null) {
    // Idle takeover by an eligible replacement.
    await assertPickOperatorEligible(trx, shopId, userId);
    const threshold = await resolvePickRecoveryThresholdMinutes(trx, shopId, batchId);

    const reservedForOther =
      batch.assigned_operator_id !== null &&
      batch.assigned_operator_id !== batch.picked_by &&
      batch.assigned_operator_id !== userId &&
      !assignmentExpired(batch, threshold);
    if (reservedForOther) throw new PickOwnershipError('PICK_ASSIGNED_TO_OTHER');

    const idleMinutes = batch.idle_minutes ?? 0;
    if (idleMinutes < threshold) {
      // Held by an active operator: the same answer whether the caller lost a
      // concurrent claim race or tried to take over early (no forced takeover).
      throw new PickOwnershipError('PICK_ALREADY_CLAIMED', undefined, {
        idle_minutes: Math.floor(idleMinutes),
        threshold_minutes: threshold,
        recovery_eligible: false,
      });
    }

    const previousOwner = batch.picked_by;
    const custodyAckRequired = batch.units_picked > 0;
    const now = new Date();
    const [taken] = await trx('pick_batches')
      .where({
        pick_batch_id: batchId,
        shop_id: shopId,
        status: 'picking',
        picked_by: previousOwner,
      })
      .update({
        picked_by: userId,
        assigned_operator_id: userId,
        pick_assigned_at: now,
        pick_claimed_at: now,
        pick_last_activity_at: now,
        pick_claim_generation: trx.raw('gen_random_uuid()'),
        pick_custody_ack_required: custodyAckRequired,
        updated_at: now,
      })
      .returning(['pick_claim_generation']);
    if (!taken) throw new PickOwnershipError('PICK_ALREADY_CLAIMED');

    await resolvePreviousOwnerIdleAlert(trx, shopId, batchId, previousOwner);
    await writeAuditLog(trx, {
      shopId,
      operatorId: userId,
      actionType: 'pick_takeover',
      entityType: 'pick_batch',
      entityId: batchId,
      metadata: {
        previous_picked_by: previousOwner,
        new_picked_by: userId,
        idle_minutes: Math.floor(idleMinutes),
        threshold_minutes: threshold,
        units_picked_at_takeover: batch.units_picked,
        custody_ack_required: custodyAckRequired,
        previous_claim_generation: batch.pick_claim_generation,
        new_claim_generation: taken.pick_claim_generation,
      },
    });
    console.info('[WMS_BATCH_TAKEN_OVER]', { pick_batch_id: batchId, previousOwner, userId, shopId });

    return {
      pick_batch_id: batchId,
      status: 'picking',
      pick_claim_generation: taken.pick_claim_generation,
      custody_ack_required: custodyAckRequired,
      units_picked: batch.units_picked,
      takeover: { previous_picked_by: previousOwner, idle_minutes: Math.floor(idleMinutes), threshold_minutes: threshold },
      notifications: [
        {
          kind: 'user',
          userId: previousOwner,
          batchId,
          title: 'Pick batch taken over',
          body: `Batch ${short(batchId)} was taken over after inactivity. Hand any picked items to the new picker.`,
        },
      ],
    };
  }

  throw new PickOwnershipError('PICK_NOT_CLAIMABLE', `Batch is not in pending status: ${batch.status}`, {
    status: batch.status,
  });
}

export type AssignPickBatchResult = {
  pick_batch_id: string;
  status: string;
  assigned_operator_id: number | null;
  picked_by: number | null;
  notifications: PickNotificationIntent[];
};

/**
 * Owner/admin assignment.
 *  - pending: assign, reassign or return to first-to-claim (null) at any time.
 *  - picking: only once idle for the recovery threshold (no early forced
 *    takeover). Custody does NOT move here — the current picker keeps it until
 *    the new assignee (or, with null, any eligible operator) claims.
 */
export async function assignPickBatch(
  trx: Knex.Transaction,
  input: { shopId: number; batchId: string; actingUserId: number; assigneeId: number | null }
): Promise<AssignPickBatchResult> {
  const { shopId, batchId, actingUserId } = input;
  const assigneeId =
    input.assigneeId === null ? null : await assertPickOperatorEligible(trx, shopId, input.assigneeId);

  const batch = await lockPickBatch(trx, shopId, batchId);
  if (!batch) throw new PickOwnershipError('PICK_BATCH_NOT_FOUND');

  let threshold: number | null = null;
  if (batch.status === 'pending') {
    if (batch.picked_by !== null) throw new PickOwnershipError('PICK_NOT_REASSIGNABLE');
  } else if (batch.status === 'picking' && batch.picked_by !== null) {
    threshold = await resolvePickRecoveryThresholdMinutes(trx, shopId, batchId);
    const idleMinutes = batch.idle_minutes ?? 0;
    if (idleMinutes < threshold) {
      throw new PickOwnershipError('PICK_NOT_IDLE', 'Batch is not idle long enough to reassign', {
        idle_minutes: Math.floor(idleMinutes),
        threshold_minutes: threshold,
      });
    }
  } else {
    throw new PickOwnershipError('PICK_NOT_REASSIGNABLE', `Batch is not reassignable: ${batch.status}`, {
      status: batch.status,
    });
  }

  const [updated] = await trx('pick_batches')
    .where({ pick_batch_id: batchId, shop_id: shopId, status: batch.status })
    .modify((q) => {
      if (batch.picked_by === null) q.whereNull('picked_by');
      else q.where('picked_by', batch.picked_by);
    })
    .update({
      assigned_operator_id: assigneeId,
      pick_assigned_at: assigneeId === null ? null : trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning(['pick_batch_id', 'status', 'assigned_operator_id', 'picked_by']);
  if (!updated) throw new PickOwnershipError('PICK_NOT_REASSIGNABLE');

  const isRecovery = batch.status === 'picking';
  await writeAuditLog(trx, {
    shopId,
    operatorId: actingUserId,
    actionType: isRecovery ? 'pick_reassign' : 'pick_assign',
    entityType: 'pick_batch',
    entityId: batchId,
    metadata: {
      previous_assigned_operator_id: batch.assigned_operator_id,
      assigned_operator_id: assigneeId,
      picked_by: batch.picked_by,
      status: batch.status,
      ...(isRecovery ? { idle_minutes: Math.floor(batch.idle_minutes ?? 0), threshold_minutes: threshold } : {}),
    },
  });

  const notifications: PickNotificationIntent[] = [];
  if (assigneeId !== null && assigneeId !== batch.assigned_operator_id) {
    notifications.push({
      kind: 'user',
      userId: assigneeId,
      batchId,
      title: isRecovery ? 'Pick batch ready to take over' : 'Pick batch assigned to you',
      body: isRecovery
        ? `Batch ${short(batchId)} was reassigned to you. Claim it to take over; confirmed picks are kept.`
        : `Batch ${short(batchId)} is assigned to you. Claim it to start picking.`,
    });
  }
  if (assigneeId === null && batch.assigned_operator_id !== null) {
    notifications.push({
      kind: 'operators',
      batchId,
      title: 'Pick batch open to claim',
      body: `Batch ${short(batchId)} is available — first one to claim picks it.`,
    });
  }
  if (isRecovery && batch.picked_by !== null && batch.picked_by !== assigneeId) {
    notifications.push({
      kind: 'user',
      userId: batch.picked_by,
      batchId,
      title: 'Pick batch reassigned',
      body: `Batch ${short(batchId)} was reassigned after inactivity. It transfers when the new picker claims it.`,
    });
  }

  return { ...updated, notifications };
}

/** Explicit tote/custody acknowledgement by the replacement operator. */
export async function acknowledgePickCustody(
  trx: Knex.Transaction,
  input: { shopId: number; batchId: string; userId: number; generation: unknown }
): Promise<{ pick_batch_id: string; units_picked: number }> {
  const { shopId, batchId, userId, generation } = input;
  const batch = await lockPickBatch(trx, shopId, batchId);
  if (!batch) throw new PickOwnershipError('PICK_BATCH_NOT_FOUND');
  assertPickWriteOwnership(batch, userId, generation, { requireCustodyAck: false });
  if (!batch.pick_custody_ack_required) throw new PickOwnershipError('PICK_CUSTODY_ACK_NOT_REQUIRED');

  const updated = await trx('pick_batches')
    .where({
      pick_batch_id: batchId,
      shop_id: shopId,
      picked_by: userId,
      pick_claim_generation: generation as string,
      pick_custody_ack_required: true,
    })
    .update({ pick_custody_ack_required: false, pick_last_activity_at: trx.fn.now(), updated_at: trx.fn.now() });
  if (updated !== 1) throw new PickOwnershipError('PICK_GENERATION_STALE');

  await writeAuditLog(trx, {
    shopId,
    operatorId: userId,
    actionType: 'pick_custody_ack',
    entityType: 'pick_batch',
    entityId: batchId,
    metadata: { units_picked: batch.units_picked, pick_claim_generation: generation },
  });
  return { pick_batch_id: batchId, units_picked: batch.units_picked };
}

/**
 * Worker step: return expired, unclaimed assignments to first-to-claim.
 * Covers pending batches and idle-recovery reassignments that the target never
 * claimed. Custody (picked_by) is never changed here.
 */
export async function expireStalePickAssignments(
  trx: Knex.Transaction,
  shopId: number
): Promise<{ expired: string[]; notifications: PickNotificationIntent[] }> {
  const candidates: string[] = await trx('pick_batches')
    .where({ shop_id: shopId })
    .whereIn('status', ['pending', 'picking'])
    .whereNotNull('assigned_operator_id')
    .whereNotNull('pick_assigned_at')
    .whereRaw('picked_by IS DISTINCT FROM assigned_operator_id')
    .orderBy('pick_batch_id', 'asc')
    .pluck('pick_batch_id');

  const expired: string[] = [];
  const notifications: PickNotificationIntent[] = [];
  for (const batchId of candidates) {
    const batch = await lockPickBatch(trx, shopId, batchId);
    if (!batch || !['pending', 'picking'].includes(batch.status)) continue;
    const threshold = await resolvePickRecoveryThresholdMinutes(trx, shopId, batchId);
    if (!assignmentExpired(batch, threshold)) continue;

    const updated = await trx('pick_batches')
      .where({
        pick_batch_id: batchId,
        shop_id: shopId,
        status: batch.status,
        assigned_operator_id: batch.assigned_operator_id,
      })
      .modify((q) => {
        if (batch.picked_by === null) q.whereNull('picked_by');
        else q.where('picked_by', batch.picked_by);
      })
      .update({ assigned_operator_id: null, pick_assigned_at: null, updated_at: trx.fn.now() });
    if (updated !== 1) continue;

    await writeAuditLog(trx, {
      shopId,
      operatorId: null,
      actionType: 'pick_assignment_expired',
      entityType: 'pick_batch',
      entityId: batchId,
      metadata: {
        previous_assigned_operator_id: batch.assigned_operator_id,
        picked_by: batch.picked_by,
        status: batch.status,
        assignment_age_minutes: Math.floor(batch.assignment_age_minutes ?? 0),
        threshold_minutes: threshold,
      },
    });
    expired.push(batchId);
    notifications.push({
      kind: 'operators',
      batchId,
      title: 'Pick batch open to claim',
      body: `Batch ${short(batchId)} was not claimed in time — first one to claim picks it.`,
    });
  }
  return { expired, notifications };
}
