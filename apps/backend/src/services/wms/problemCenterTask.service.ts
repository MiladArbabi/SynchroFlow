// apps/backend/src/services/wms/problemCenterTask.service.ts
import { Knex } from 'knex';

/**
 * PROBLEM CENTER TASK SERVICE (GH-1049)
 * --------------------------------------
 * Server-owned creation of a Problem Center incident.
 *
 * Contract:
 * - Receives the CALLER's transaction and MUST NOT open its own. The incident
 *   commits or rolls back with whatever created it (a Pick exception, today).
 * - Exactly one Problem task per source exception. For Pick that identity is
 *   the real pick_exception_id, carried in source_pick_exception_id and
 *   backed by the partial unique index added in migration 0169.
 * - A shop that has not configured a problem bin still gets the incident.
 *   problem_bin_location is copied when configured and left NULL otherwise —
 *   physical bin custody is a later slice and must never suppress the record
 *   of a real physical discrepancy.
 * - This path deliberately does NOT increment prob_label_sequence and does NOT
 *   queue a PROB barcode print job. The operator is not asked to produce a
 *   physical problem label while picking. The generic Problem Center endpoint
 *   keeps its existing label/print behaviour.
 *
 * Caller must have SET LOCAL "app.current_tenant" active (RLS is FORCED on
 * problem_center_tasks).
 */

export type ProblemCenterSource =
  | 'pick'
  | 'stow'
  | 'receive'
  | 'pack'
  | 'returns'
  | 'reconciliation';

export interface CreateProblemCenterTaskInput {
  shopId: number;
  source: ProblemCenterSource;
  /** Value written to the legacy source_exception_id column. */
  sourceExceptionId: string;
  /**
   * Constrained one-per-exception identity. Set for Pick exceptions; left
   * undefined by callers whose source_exception_id is not a pick_exceptions PK.
   */
  sourcePickExceptionId?: string | null;
  /**
   * S4-3B: the held Receive unit this task stands for. Set only by Receive
   * held capture (source 'receive', quantity 1); backed by the 0224 partial
   * unique index, so it is the one-task-per-unit replay authority.
   */
  lasyncroUnitId?: string | null;
  lasyncroVariantId: string;
  /** Problem quantity — the units that need physical intervention. */
  quantity: number;
  exceptionType: string;
  notes?: string | null;
}

export interface CreateProblemCenterTaskResult {
  problem_task_id: string;
  /** false when an existing task for the same source exception was reused. */
  created: boolean;
  problem_bin_location: string | null;
}

export async function createProblemCenterTask(
  trx: Knex.Transaction,
  input: CreateProblemCenterTaskInput
): Promise<CreateProblemCenterTaskResult> {
  const {
    shopId,
    source,
    sourceExceptionId,
    sourcePickExceptionId,
    lasyncroVariantId,
    quantity,
    exceptionType,
    notes,
  } = input;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('PROBLEM_TASK_QUANTITY_INVALID');
  }

  // Receive tasks always represent exactly one held LSU. Never let an
  // incomplete Receive request fall through to the generic insertion path.
  if (source === 'receive') {
    if (typeof input.lasyncroUnitId !== 'string' || !input.lasyncroUnitId.trim()
      || typeof sourceExceptionId !== 'string' || !sourceExceptionId.trim() || quantity !== 1) {
      throw new Error('PROBLEM_TASK_RECEIVE_UNIT_INVALID');
    }
    return createReceiveUnitTask(trx, { ...input, lasyncroUnitId: input.lasyncroUnitId });
  }
  if (input.lasyncroUnitId != null) {
    throw new Error('PROBLEM_TASK_RECEIVE_UNIT_INVALID');
  }

  const findExisting = async () => {
    if (sourcePickExceptionId) {
      return trx('problem_center_tasks')
        .where({
          shop_id: shopId,
          source_pick_exception_id: sourcePickExceptionId,
        })
        .first('problem_task_id', 'problem_bin_location');
    }

    if (source === 'reconciliation') {
      return trx('problem_center_tasks')
        .where({
          shop_id: shopId,
          source: 'reconciliation',
          source_exception_id: sourceExceptionId,
        })
        .first('problem_task_id', 'problem_bin_location');
    }

    return undefined;
  };

  const existing = await findExisting();

  if (existing) {
    return {
      problem_task_id: existing.problem_task_id,
      created: false,
      problem_bin_location: existing.problem_bin_location ?? null,
    };
  }

  // Best effort only — a missing configuration must not block the incident.
  const settings = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .first('problem_bin_location');

  const problemBinLocation: string | null =
    settings?.problem_bin_location ?? null;

  /**
   * The partial unique index is the authority, not the SELECT above: a
   * concurrent creator may commit between them. ON CONFLICT targets the same
   * partial predicate so the race resolves to the existing incident instead of
   * aborting the caller's transaction. Rows with a NULL
   * source_pick_exception_id are outside the index and insert normally.
   */
  const insertQuery = trx('problem_center_tasks')
    .insert({
      shop_id: shopId,
      status: 'open',
      source,
      source_exception_id: sourceExceptionId,
      source_pick_exception_id: sourcePickExceptionId ?? null,
      lasyncro_variant_id: lasyncroVariantId,
      quantity,
      exception_type: exceptionType,
      problem_bin_location: problemBinLocation,
      notes: notes ?? null,
    });

  /**
   * Pick keeps its dedicated partial-unique target.
   *
   * Reconciliation uses ON CONFLICT DO NOTHING without a target so PostgreSQL
   * can use the reconciliation partial unique index added by migration 0181.
   * Generic/manual sources retain their previous insertion semantics.
   */
  const replaySafeInsert =
    sourcePickExceptionId
      ? insertQuery
          .onConflict(
            trx.raw(
              '(shop_id, source_pick_exception_id) WHERE source_pick_exception_id IS NOT NULL'
            ) as unknown as string
          )
          .ignore()
      : source === 'reconciliation'
        ? insertQuery.onConflict().ignore()
        : insertQuery;

  const inserted =
    await replaySafeInsert.returning([
      'problem_task_id',
      'problem_bin_location',
    ]);

  if (inserted.length === 1) {
    return {
      problem_task_id: inserted[0].problem_task_id,
      created: true,
      problem_bin_location: inserted[0].problem_bin_location ?? null,
    };
  }

  const raced = await findExisting();

  if (!raced) {
    throw new Error('PROBLEM_TASK_CREATE_FAILED');
  }

  return {
    problem_task_id: raced.problem_task_id,
    created: false,
    problem_bin_location: raced.problem_bin_location ?? null,
  };
}

/**
 * S4-3B — one Problem Center task per held Receive unit (K7 / D2).
 *
 * - quantity is always 1: the task IS the unit; extra defects on the same
 *   unit are notes on this task, never another task or held quantity.
 * - problem_bin_location stays NULL: custody is declared only by S4-4
 *   placement, never by copying the shop's default bin (S4-3 audit F3).
 * - Replay of the same unit returns the existing task; the same unit claimed
 *   by a different exception fails closed.
 */
async function createReceiveUnitTask(
  trx: Knex.Transaction,
  input: CreateProblemCenterTaskInput & { lasyncroUnitId: string }
): Promise<CreateProblemCenterTaskResult> {
  const { shopId, source, sourceExceptionId, lasyncroUnitId, lasyncroVariantId, quantity, exceptionType, notes } = input;

  if (source !== 'receive' || quantity !== 1 || !sourceExceptionId) {
    throw new Error('PROBLEM_TASK_RECEIVE_UNIT_INVALID');
  }

  const findExisting = () =>
    trx('problem_center_tasks')
      .where({ shop_id: shopId, source: 'receive', lasyncro_unit_id: lasyncroUnitId })
      .first('problem_task_id', 'problem_bin_location', 'source_exception_id');

  const reuse = (row: any): CreateProblemCenterTaskResult => {
    if (row.source_exception_id !== sourceExceptionId) {
      throw new Error(`PROBLEM_TASK_RECEIVE_UNIT_CONFLICT: ${lasyncroUnitId} already belongs to another exception`);
    }
    return { problem_task_id: row.problem_task_id, created: false, problem_bin_location: row.problem_bin_location ?? null };
  };

  const existing = await findExisting();
  if (existing) return reuse(existing);

  const inserted = await trx('problem_center_tasks')
    .insert({
      shop_id: shopId,
      status: 'open',
      source: 'receive',
      source_exception_id: sourceExceptionId,
      source_pick_exception_id: null,
      lasyncro_unit_id: lasyncroUnitId,
      lasyncro_variant_id: lasyncroVariantId,
      quantity: 1,
      exception_type: exceptionType,
      problem_bin_location: null,
      notes: notes ?? null,
    })
    .onConflict(
      trx.raw(
        "(shop_id, lasyncro_unit_id) WHERE source = 'receive' AND lasyncro_unit_id IS NOT NULL"
      ) as unknown as string
    )
    .ignore()
    .returning(['problem_task_id', 'problem_bin_location']);

  if (inserted.length === 1) {
    return { problem_task_id: inserted[0].problem_task_id, created: true, problem_bin_location: null };
  }

  const raced = await findExisting();
  if (!raced) throw new Error('PROBLEM_TASK_CREATE_FAILED');
  return reuse(raced);
}
