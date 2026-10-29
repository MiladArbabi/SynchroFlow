import type { Knex } from 'knex';

import { assertReceiveMutable, lockReceiveJob, receiveError } from './receiveWorkflowLock.service.js';
import { pickableLocationCondition } from '../inventory/pickableLocation.js';

/**
 * S8-C5 / S4-4B — held LSU → problem bin custody (0226).
 *
 * A recoverable held unit (S4-3B) enters custody when the operator scans it
 * into a non-pickable problem bin. One transaction, GH-1245 lock order
 * PO → job → line → unit → task, writes the 0226 custody event, the unit's
 * location + held_placed_at and the existing Problem Center task's bin. The
 * 0226 guards accept exactly that write set and freeze it afterwards.
 *
 * Replay: the event is looked up by device_event_id BEFORE any insert, under
 * the job lock. ON CONFLICT DO NOTHING is never used here — 0226's BEFORE
 * INSERT trigger refuses a placed unit before conflict arbitration, so an
 * ignore-on-conflict replay would raise instead of returning the result.
 *
 * Held stock stays non-sellable: no movement, truth, reservation or Stow task
 * is written; the unit keeps status 'held' (S4-2 gates exclude it).
 */

function custodyError(errorCode: string, message: string, statusCode = 409) {
  return Object.assign(receiveError(`${errorCode}: ${message}`, statusCode), { errorCode });
}

export interface PlaceHeldUnitInput {
  shopId: number;
  receiveJobId: string;
  lasyncroUnitId: string;
  locationCode: string;
  deviceEventId: string;
  placedBy: number;
}

export interface HeldUnitCustody {
  device_event_id: string;
  lasyncro_unit_id: string;
  problem_task_id: string;
  location_code: string;
  placed_at: string;
  replayed: boolean;
}

function custodyResult(event: any, replayed: boolean): HeldUnitCustody {
  return {
    device_event_id: event.device_event_id,
    lasyncro_unit_id: event.lasyncro_unit_id,
    problem_task_id: event.problem_task_id,
    location_code: event.location_code,
    placed_at: new Date(event.placed_at).toISOString(),
    replayed,
  };
}

export async function placeHeldUnitInProblemBin(
  trx: Knex.Transaction,
  input: PlaceHeldUnitInput
): Promise<HeldUnitCustody> {
  const { shopId, receiveJobId, lasyncroUnitId, locationCode, deviceEventId, placedBy } = input;

  const { job } = await lockReceiveJob(trx, shopId, receiveJobId);

  // Replay authority first, under the job lock: a same-event retry waits here
  // behind the original and then sees its committed row.
  const prior = await trx('receive_held_custody_events as e')
    .join('inventory_units as iu', function joinUnit() {
      this.on('iu.shop_id', 'e.shop_id').andOn('iu.lasyncro_unit_id', 'e.lasyncro_unit_id');
    })
    .join('receive_job_lines as l', 'l.receive_job_line_id', 'iu.receive_job_line_id')
    .where('e.shop_id', shopId).where('l.shop_id', shopId).where('e.device_event_id', deviceEventId)
    .first('e.*', 'l.receive_job_id');
  if (prior) {
    if (prior.receive_job_id !== receiveJobId || prior.lasyncro_unit_id !== lasyncroUnitId || prior.location_code !== locationCode) {
      throw custodyError('RECEIVE_HELD_CUSTODY_REPLAY_CONFLICT', 'this device_event_id already recorded a different placement');
    }
    return custodyResult(prior, true);
  }

  assertReceiveMutable(job);

  const unitRef = await trx('inventory_units as iu')
    .join('receive_job_lines as l', 'l.receive_job_line_id', 'iu.receive_job_line_id')
    .where('iu.shop_id', shopId).where('l.shop_id', shopId)
    .where({ 'iu.lasyncro_unit_id': lasyncroUnitId, 'l.receive_job_id': receiveJobId })
    .first('iu.receive_job_line_id');
  if (!unitRef) throw custodyError('RECEIVE_HELD_UNIT_NOT_FOUND', `${lasyncroUnitId} is not a unit of this Receive`, 404);

  await trx('receive_job_lines')
    .where({ shop_id: shopId, receive_job_id: receiveJobId, receive_job_line_id: unitRef.receive_job_line_id })
    .forUpdate().first('receive_job_line_id');
  const unit = await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
    .forUpdate()
    .first('lasyncro_unit_id', 'status', 'held_placed_at', 'current_location_code', 'label_printed_at');

  if (unit.status !== 'held') {
    throw custodyError('RECEIVE_HELD_UNIT_NOT_HELD', `${lasyncroUnitId} is not a recoverable held unit`);
  }
  // One placement per held LSU: no second placement and no relocation.
  if (unit.held_placed_at || unit.current_location_code) {
    throw custodyError('RECEIVE_HELD_UNIT_ALREADY_PLACED', `${lasyncroUnitId} is already in problem-bin custody`);
  }
  if (!unit.label_printed_at) {
    throw custodyError('RECEIVE_HELD_LABEL_REQUIRED', `${lasyncroUnitId} needs its label acknowledged before placement`);
  }

  // The S4-3B task is the unit; custody never creates another one.
  const task = await trx('problem_center_tasks')
    .where({ shop_id: shopId, source: 'receive', lasyncro_unit_id: lasyncroUnitId })
    .forUpdate()
    .first('problem_task_id', 'problem_bin_location');
  if (!task) throw custodyError('RECEIVE_HELD_TASK_MISSING', `${lasyncroUnitId} has no Receive Problem Center task`);

  // A real, active problem-zone bin of this shop that is not sellable-from
  // (pickable rule as quarantine, wms.controller). Other non-pickable zones —
  // receive, pack, quarantine — are not custody. Unknown and foreign bins are
  // indistinguishable.
  const bin = await trx('warehouse_locations as wl')
    .where({
      'wl.shop_id': shopId, 'wl.location_code': locationCode, 'wl.active': true, 'wl.type': 'bin', 'wl.zone_type': 'problem',
    })
    .forShare()
    .first('wl.location_code', trx.raw('(?) AS pickable', [pickableLocationCondition(trx)]));
  if (!bin || bin.pickable) {
    throw custodyError('RECEIVE_PROBLEM_BIN_INVALID', `${locationCode} is not an active non-pickable problem bin`);
  }

  const [event] = await trx('receive_held_custody_events')
    .insert({
      shop_id: shopId,
      device_event_id: deviceEventId,
      lasyncro_unit_id: lasyncroUnitId,
      problem_task_id: task.problem_task_id,
      location_code: locationCode,
      placed_by: placedBy,
    })
    .returning('*');

  await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: lasyncroUnitId })
    .update({ held_placed_at: event.placed_at, current_location_code: locationCode, updated_at: new Date() });
  await trx('problem_center_tasks')
    .where({ shop_id: shopId, problem_task_id: task.problem_task_id })
    .update({ problem_bin_location: locationCode, updated_at: new Date() });

  console.info('[RECEIVE_HELD_CUSTODY] placed', { shopId, receiveJobId, lasyncroUnitId, locationCode });
  return custodyResult(event, false);
}

/**
 * S4-4B close gate: every held LSU of every closing line is in confirmed
 * problem-bin custody — event, unit and task agreeing on one bin. Held
 * Problem Center tasks stay open; closing does not resolve them.
 */
export async function assertHeldCustodyComplete(
  trx: Knex.Transaction,
  shopId: number,
  lines: Array<{ receive_job_line_id: string; quantity_held_recoverable: number | string | null }>
): Promise<void> {
  const heldLines = lines.filter((l) => Number(l.quantity_held_recoverable ?? 0) > 0);
  if (heldLines.length === 0) return;

  const rows = await trx('inventory_units as iu')
    .join('receive_held_custody_events as e', function joinEvent() {
      this.on('e.shop_id', 'iu.shop_id').andOn('e.lasyncro_unit_id', 'iu.lasyncro_unit_id');
    })
    .join('problem_center_tasks as t', function joinTask() {
      this.on('t.shop_id', 'e.shop_id').andOn('t.problem_task_id', 'e.problem_task_id');
    })
    .where('iu.shop_id', shopId)
    .whereIn('iu.receive_job_line_id', heldLines.map((l) => l.receive_job_line_id))
    .where('iu.status', 'held')
    .whereNotNull('iu.held_placed_at')
    .whereRaw('iu.current_location_code = e.location_code')
    .whereRaw('t.problem_bin_location = e.location_code')
    .groupBy('iu.receive_job_line_id')
    .select('iu.receive_job_line_id', trx.raw('COUNT(*)::int AS placed'));
  const placed = new Map(rows.map((r: any) => [r.receive_job_line_id as string, Number(r.placed)]));

  const outstanding = heldLines.filter((l) => placed.get(l.receive_job_line_id) !== Number(l.quantity_held_recoverable));
  if (outstanding.length > 0) {
    throw custodyError('RECEIVE_HELD_CUSTODY_REQUIRED', `${outstanding.length} line(s) have held units not yet in problem-bin custody`);
  }
}
