import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

import { RESOLVABLE_PROBLEM_STATUSES, type ProblemResolutionAction } from './problemCenterResolutionPolicy.js';

/**
 * S8-C5 / S4-5 I2 — Problem Center resolution of a held Receive unit
 * (contract SF-RECEIVE-S8C5-S4-CONTRACT-026 + Addenda A1–A3; 0227 certified in I1).
 *
 * A Receive unit task (source 'receive' + lasyncro_unit_id) is resolved here,
 * never by the generic GH-1238 path:
 *
 *   re_stow           one pending receive_recovery Stow; the task stays open
 *                     until the physical recovery Stow completes (I3).
 *   discard/write_off the 'discarded' outcome event, the unit → 'discarded' in
 *                     place and the task → 'resolved', in one transaction.
 *
 * Neither writes inventory_movements or inventory_truth: recovery credit is
 * written only by the I3 recovery Stow confirmation (A2/A3); disposal never
 * credits or debits.
 *
 * Lock order (A1 D.T4): read the immutable task → LSU identity without a lock,
 * then inventory_units FOR UPDATE → problem_center_tasks FOR UPDATE, then
 * revalidate everything. An existing stow_tasks row is never locked here;
 * creating the recovery Stow is an insert. The 0227 guards are the
 * fail-closed backstop.
 */

/** 0224 receive_exceptions_disposition_valid: the ratified recoverable classifications (K2). */
export const RECOVERABLE_HELD_EXCEPTION_TYPES = ['defect', 'packaging_damage'] as const;

const DISPOSAL_ACTIONS = new Set<ProblemResolutionAction>(['discard', 'write_off']);
const DISCARD_EVENT_NAMESPACE = '6f1c7a52-3d0e-4b8f-9a21-5c4e8d7b0a13';

export class ReceiveHeldResolutionError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    readonly reason?: string
  ) {
    super(reason ? `${code}: ${reason}` : code);
  }
}

const notEligible = (reason: string) => new ReceiveHeldResolutionError('RECEIVE_RECOVERY_NOT_ELIGIBLE', 409, reason);

export interface ReceiveHeldTaskIdentity {
  problem_task_id: string;
  lasyncro_unit_id: string;
}

/**
 * Unlocked identity read. Returns the task's LSU only for a Receive unit task;
 * every other task keeps the generic resolution path.
 */
export async function readReceiveHeldTaskIdentity(
  trx: Knex.Transaction,
  shopId: number,
  taskId: string
): Promise<ReceiveHeldTaskIdentity | null> {
  const row = await trx('problem_center_tasks')
    .where({ shop_id: shopId, problem_task_id: taskId, source: 'receive' })
    .whereNotNull('lasyncro_unit_id')
    .first('problem_task_id', 'lasyncro_unit_id');
  return row ? { problem_task_id: row.problem_task_id, lasyncro_unit_id: row.lasyncro_unit_id } : null;
}

export interface ResolveReceiveHeldTaskInput {
  shopId: number;
  userId: number;
  identity: ReceiveHeldTaskIdentity;
  action: ProblemResolutionAction;
  notes: string | null;
  deviceEventId?: string | null;
}

export type ResolveReceiveHeldTaskResult =
  | {
      problem_task_id: string;
      resolution_action: 're_stow';
      status: string;
      resolved: false;
      replayed: boolean;
      stow_task_id: string;
    }
  | {
      problem_task_id: string;
      resolution_action: 'discard' | 'write_off';
      status: 'resolved';
      resolved: true;
      replayed: boolean;
      device_event_id: string;
    };

export async function resolveReceiveHeldTask(
  trx: Knex.Transaction,
  input: ResolveReceiveHeldTaskInput
): Promise<ResolveReceiveHeldTaskResult> {
  const { shopId, userId, identity, action, notes } = input;
  const taskId = identity.problem_task_id;
  const lsu = identity.lasyncro_unit_id;

  if (action !== 're_stow' && !DISPOSAL_ACTIONS.has(action)) {
    throw new ReceiveHeldResolutionError('RESOLUTION_NOT_ELIGIBLE', 409, 'action_not_supported_for_incident');
  }

  // ── A1 D.T4: unit → task ────────────────────────────────────────────────
  const unit = await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lsu })
    .forUpdate()
    .first('status', 'held_placed_at', 'current_location_code', 'receive_job_line_id', 'lasyncro_variant_id');

  const task = await trx('problem_center_tasks')
    .where({ shop_id: shopId, problem_task_id: taskId })
    .forUpdate()
    .first(
      'status',
      'source',
      'lasyncro_unit_id',
      'lasyncro_variant_id',
      'exception_type',
      'source_exception_id',
      'problem_bin_location',
      'resolution_action'
    );

  if (!task || task.source !== 'receive' || task.lasyncro_unit_id !== lsu) {
    throw new ReceiveHeldResolutionError('TASK_NOT_FOUND', 404);
  }

  // ── Replay of a completed decision (before the terminal check) ──────────
  const outcome = await trx('receive_held_recovery_events')
    .where({ shop_id: shopId, problem_task_id: taskId })
    .first('outcome', 'device_event_id');
  if (outcome) {
    if (
      DISPOSAL_ACTIONS.has(action) &&
      outcome.outcome === 'discarded' &&
      task.resolution_action === action &&
      (!input.deviceEventId || input.deviceEventId === outcome.device_event_id)
    ) {
      return {
        problem_task_id: taskId,
        resolution_action: action as 'discard' | 'write_off',
        status: 'resolved',
        resolved: true,
        replayed: true,
        device_event_id: outcome.device_event_id,
      };
    }
    throw new ReceiveHeldResolutionError('TASK_ALREADY_RESOLVED', 409);
  }

  if (!(RESOLVABLE_PROBLEM_STATUSES as readonly string[]).includes(task.status)) {
    throw new ReceiveHeldResolutionError('TASK_ALREADY_RESOLVED', 409);
  }

  const liveStow = await trx('stow_tasks')
    .where({ shop_id: shopId, trigger: 'receive_recovery', source_task_id: taskId })
    .whereNot('status', 'cancelled')
    .first('stow_task_id');

  if (action === 're_stow' && liveStow) {
    // One live recovery Stow per task: the same decision again is a replay.
    return {
      problem_task_id: taskId,
      resolution_action: 're_stow',
      status: task.status,
      resolved: false,
      replayed: true,
      stow_task_id: liveStow.stow_task_id,
    };
  }

  // ── Revalidate eligibility under the locks ──────────────────────────────
  if (!unit) throw notEligible('unit_not_found');
  if (unit.status !== 'held') throw notEligible('unit_not_held');
  if (!unit.held_placed_at || !unit.current_location_code) throw notEligible('unit_not_in_custody');
  if (unit.lasyncro_variant_id !== task.lasyncro_variant_id) throw notEligible('unit_task_mismatch');
  if (!(RECOVERABLE_HELD_EXCEPTION_TYPES as readonly string[]).includes(task.exception_type)) {
    throw notEligible('classification_not_recoverable');
  }

  const custody = await trx('receive_held_custody_events')
    .where({ shop_id: shopId, lasyncro_unit_id: lsu, problem_task_id: taskId })
    .first('location_code');
  if (
    !custody ||
    custody.location_code !== unit.current_location_code ||
    task.problem_bin_location !== custody.location_code
  ) {
    throw notEligible('custody_not_verified');
  }

  const evidence = await trx('receive_exceptions')
    .where({ shop_id: shopId, receive_exception_id: task.source_exception_id })
    .first('disposition', 'exception_type', 'receive_job_line_id');
  if (
    !evidence ||
    evidence.disposition !== 'recoverable_held' ||
    !(RECOVERABLE_HELD_EXCEPTION_TYPES as readonly string[]).includes(evidence.exception_type) ||
    evidence.receive_job_line_id !== unit.receive_job_line_id
  ) {
    throw notEligible('evidence_not_recoverable');
  }

  const job = await trx('receive_job_lines as l')
    .join('receive_jobs as j', function joinJob() {
      this.on('j.receive_job_id', '=', 'l.receive_job_id').andOn('j.shop_id', '=', 'l.shop_id');
    })
    .where({ 'l.shop_id': shopId, 'l.receive_job_line_id': unit.receive_job_line_id })
    .first('j.status');
  if (job?.status !== 'closed') throw notEligible('receive_not_closed');

  // ── Apply ───────────────────────────────────────────────────────────────
  if (action === 're_stow') {
    const [stow] = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: task.lasyncro_variant_id,
        quantity: 1,
        location_code: null,
        status: 'pending',
        trigger: 'receive_recovery',
        source_task_id: taskId,
        lasyncro_order_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('stow_task_id');

    console.info('[RECEIVE_HELD_RECOVERY_STOW_CREATED]', {
      problem_task_id: taskId,
      lasyncro_unit_id: lsu,
      stow_task_id: stow.stow_task_id,
      shopId,
    });
    return {
      problem_task_id: taskId,
      resolution_action: 're_stow',
      status: task.status,
      resolved: false,
      replayed: false,
      stow_task_id: stow.stow_task_id,
    };
  }

  if (liveStow) {
    throw new ReceiveHeldResolutionError('RECEIVE_RECOVERY_STOW_ACTIVE', 409, 'live_recovery_stow');
  }

  const deviceEventId =
    input.deviceEventId ?? uuidv5(`${taskId}:${lsu}:discarded`, DISCARD_EVENT_NAMESPACE);
  const now = new Date();
  // This task has no outcome (checked under the locks), so a replay-key
  // collision means the device event already belongs to another decision.
  // Only that exact violation becomes a 409; the throw rolls back the request.
  try {
    await trx('receive_held_recovery_events').insert({
      shop_id: shopId,
      device_event_id: deviceEventId,
      lasyncro_unit_id: lsu,
      problem_task_id: taskId,
      outcome: 'discarded',
      stow_task_id: null,
      location_code: custody.location_code,
      recorded_by: userId,
    });
  } catch (err: unknown) {
    const pg = err as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === 'receive_held_recovery_events_pkey') {
      throw new ReceiveHeldResolutionError('DEVICE_EVENT_ID_CONFLICT', 409, 'device_event_id_in_use');
    }
    throw err;
  }
  await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lsu })
    .update({ status: 'discarded', updated_at: now });
  await trx('problem_center_tasks')
    .where({ shop_id: shopId, problem_task_id: taskId })
    .update({
      status: 'resolved',
      resolution_action: action,
      resolution_notes: notes,
      resolved_by: userId,
      resolved_at: now,
      updated_at: now,
    });

  console.info('[RECEIVE_HELD_DISPOSED]', {
    problem_task_id: taskId,
    lasyncro_unit_id: lsu,
    resolution_action: action,
    location_code: custody.location_code,
    shopId,
  });
  return {
    problem_task_id: taskId,
    resolution_action: action as 'discard' | 'write_off',
    status: 'resolved',
    resolved: true,
    replayed: false,
    device_event_id: deviceEventId,
  };
}
