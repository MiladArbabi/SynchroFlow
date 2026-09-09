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
  | 'returns';

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

  const findExisting = async () =>
    sourcePickExceptionId
      ? trx('problem_center_tasks')
          .where({
            shop_id: shopId,
            source_pick_exception_id: sourcePickExceptionId,
          })
          .first('problem_task_id', 'problem_bin_location')
      : undefined;

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
  const inserted = await trx('problem_center_tasks')
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
    })
    .onConflict(
      trx.raw(
        '(shop_id, source_pick_exception_id) WHERE source_pick_exception_id IS NOT NULL'
      ) as unknown as string
    )
    .ignore()
    .returning(['problem_task_id', 'problem_bin_location']);

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
