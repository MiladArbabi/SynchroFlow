import type { Knex } from 'knex';
import {
  problemBinError,
  quarantineUnitToProblemBin,
  type ProblemBinQuarantineAdapter,
  type QuarantineReason,
} from '../inventory/problemBinQuarantine.service.js';

/**
 * SF-PROBLEM-BIN Phase A — Stow adapter (thin).
 * Inventory, ledger, incident and custody writes belong to the shared
 * problemBinQuarantine core. This adapter only proves the LSU belongs to the
 * operator's claimed inbound Stow task and records task exception accounting
 * (quantity_excepted / finished_with_exceptions) in the same transaction.
 */
export interface StowQuarantineInput {
  shopId: number; stowTaskId: string; claimedBy: number;
  lasyncroUnitId: string; problemBinLocation: string; deviceEventId: string; quarantineReason: QuarantineReason;
}

function stowAdapter(shopId: number, stowTaskId: string, claimedBy: number): ProblemBinQuarantineAdapter {
  let task: any;
  return {
    kind: 'stow',
    contextId: stowTaskId,
    async lock(trx) {
      task = await trx('stow_tasks').where({ shop_id: shopId, stow_task_id: stowTaskId }).forUpdate().first();
      if (!task) throw problemBinError('STOW_TASK_NOT_FOUND', 404);
      if (task.claimed_by !== claimedBy) throw problemBinError('STOW_TASK_OWNED_BY_OTHER', 403);
      if (task.status !== 'in_progress' || task.trigger !== 'inbound_stock' || !task.receive_job_line_id ||
          task.quantity_placed + task.quantity_excepted >= task.quantity) throw problemBinError('STOW_TASK_NOT_QUARANTINABLE');
    },
    async assertUnit(_trx, unit) {
      if (unit.status !== 'received' || unit.lasyncro_variant_id !== task.lasyncro_variant_id ||
          unit.receive_job_line_id !== task.receive_job_line_id) throw problemBinError('STOW_QUARANTINE_LSU_MISMATCH');
    },
    async apply(trx: Knex.Transaction, _unit, now) {
      const excepted = task.quantity_excepted + 1;
      const finished = task.quantity_placed + excepted === task.quantity;
      const status = finished ? 'finished_with_exceptions' : 'in_progress';
      await trx('stow_tasks').where({ shop_id: shopId, stow_task_id: stowTaskId })
        .update({ quantity_excepted: excepted, status, updated_at: now, ...(finished ? { completed_at: now } : {}) });
      return { stow_task_id: stowTaskId, status, quantity_placed: task.quantity_placed, quantity_excepted: excepted,
        quantity_total: task.quantity, quantity_remaining: task.quantity - task.quantity_placed - excepted, is_fully_placed: finished };
    },
  };
}

/** Caller owns tenant/projection context and transaction. No capacity check:
 * a problem unit must be removable even when normal Stow bins are full. */
export async function quarantineStowUnit(trx: Knex.Transaction, input: StowQuarantineInput) {
  return quarantineUnitToProblemBin(trx, {
    shopId: input.shopId, actorId: input.claimedBy, lasyncroUnitId: input.lasyncroUnitId,
    problemBinScan: input.problemBinLocation, deviceEventId: input.deviceEventId, quarantineReason: input.quarantineReason,
    adapter: stowAdapter(input.shopId, input.stowTaskId, input.claimedBy),
  });
}
