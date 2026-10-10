// apps/backend/src/services/wms/problemCenterResolutionPolicy.ts
import type { Knex } from 'knex';

/**
 * PROBLEM CENTER RESOLUTION POLICY (GH-1238 / PC-SAFE-01)
 * --------------------------------------------------------
 * Backend-authoritative, default-deny eligibility for
 * POST /wms/problem-center/:taskId/resolve and for the client-facing generic
 * incident creation endpoint.
 *
 * A resolution is eligible only when the (source, exception_type, action)
 * combination is listed below AND the incident's persisted evidence proves
 * where its stock effect lands. Everything else is rejected with 409 before
 * any write. Stock provenance is never inferred from "the variant has one
 * positive inventory_truth row", and caller-supplied source/type never
 * authorizes a system-owned or outside-truth stock effect.
 *
 * Eligible today:
 *   pick/order_cancelled, returns/repackaging_required (GH-1202 outside-truth)
 *     re_stow | discard | write_off | quarantine — only when the system writer's
 *     evidence exists (the cancelled order / the return job).
 *   pick/pack shortage incidents (item_missing, missing_item, short_pick,
 *   wrong_item)
 *     find_replacement — investigation only; no stock effect, never closes
 *     the incident.
 *
 * Deliberately NOT eligible (no verified safe generic mechanism):
 *   reconciliation, count, stow, receive, returns/return_shortfall, unknown
 *   types; ordinary (in-truth) quarantine — it would rewrite a whole
 *   projection row; in-truth re_stow — confirmStow would debit a problem bin
 *   that never received the unit; ordinary Pick write_off / discard — the
 *   incident's units stay RESERVED at the allocation location
 *   (recordShortPickPhysicalOutcome releases only the units found) and no
 *   resolution path settles that residual reservation yet (GH-1240), so a
 *   debit would consume healthy unreserved units and leave the reservation.
 */

export const RESOLVABLE_PROBLEM_STATUSES = ['open', 'investigating'] as const;

export type ProblemResolutionAction =
  | 're_stow'
  | 'discard'
  | 'write_off'
  | 'quarantine'
  | 'find_replacement';

export const PROBLEM_RESOLUTION_ACTIONS: readonly ProblemResolutionAction[] = [
  're_stow',
  'discard',
  'write_off',
  'quarantine',
  'find_replacement',
];

export interface ProblemTaskEvidence {
  source: string;
  exception_type: string;
  source_exception_id: string | null;
  source_pick_exception_id: string | null;
  lasyncro_variant_id: string;
}

export type ProblemResolutionEligibility =
  | { eligible: true; basis: 'outside_truth' }
  | { eligible: true; basis: 'no_stock_effect' }
  | { eligible: false; reason: string };

const OUTSIDE_TRUTH_ACTIONS = new Set<ProblemResolutionAction>([
  're_stow',
  'discard',
  'write_off',
  'quarantine',
]);

const FIND_REPLACEMENT_TYPES = ['item_missing', 'missing_item', 'short_pick', 'wrong_item'];

const deny = (reason: string): ProblemResolutionEligibility => ({ eligible: false, reason });

export function isOutsideTruthIncident(task: Pick<ProblemTaskEvidence, 'source' | 'exception_type'>): boolean {
  return (
    (task.source === 'pick' && task.exception_type === 'order_cancelled') ||
    (task.source === 'returns' && task.exception_type === 'repackaging_required')
  );
}

/**
 * Read-only. Caller must hold the task row lock and have the tenant context
 * set; this function never writes.
 */
export async function evaluateProblemResolutionEligibility(
  trx: Knex.Transaction,
  shopId: number,
  task: ProblemTaskEvidence,
  action: ProblemResolutionAction
): Promise<ProblemResolutionEligibility> {
  if (isOutsideTruthIncident(task)) {
    if (!OUTSIDE_TRUTH_ACTIONS.has(action)) return deny('action_not_supported_for_incident');
    if (!task.source_exception_id) return deny('missing_system_evidence');

    if (task.exception_type === 'order_cancelled') {
      // cancellationUnwind writes the cancelled order id and no Pick exception.
      if (task.source_pick_exception_id) return deny('missing_system_evidence');
      const order = await trx('orders')
        .where({ shop_id: shopId, lasyncro_order_id: task.source_exception_id })
        .first('lasyncro_order_id');
      if (!order) return deny('missing_system_evidence');
    } else {
      const job = await trx('return_jobs')
        .where({ shop_id: shopId, return_job_id: task.source_exception_id })
        .first('return_job_id');
      if (!job) return deny('missing_system_evidence');
    }

    return { eligible: true, basis: 'outside_truth' };
  }

  if (action === 'find_replacement') {
    return (task.source === 'pick' || task.source === 'pack') &&
      FIND_REPLACEMENT_TYPES.includes(task.exception_type)
      ? { eligible: true, basis: 'no_stock_effect' }
      : deny('action_not_supported_for_incident');
  }

  return deny('action_not_supported_for_incident');
}

// ── Generic incident creation (POST /wms/problem-center) ────────────────────

/**
 * Operator-reportable classifications for the client-facing generic endpoint,
 * from its real callers: Receive "Report problem" (receiveJob.controller
 * VALID_TYPES), Pack "Report problem" (PackSessionPage) and the Pick/Stow
 * operator taxonomies. System-owned incidents (returns/*, order_cancelled,
 * reconciliation, count, bin_over_capacity) have dedicated server writers and
 * are never accepted here.
 */
export const GENERIC_PROBLEM_CLASSIFICATIONS: Readonly<Record<string, readonly string[]>> = {
  receive: [
    'defect',
    'packaging_damage',
    'wrong_item',
    'wrong_variant',
    'wrong_quantity',
    'missing_item',
    'extra_item',
    'barcode_mismatch',
    'other',
  ],
  pack: ['missing_item', 'product_defect', 'packaging_defect'],
  pick: ['item_missing', 'short_pick', 'product_defect', 'packaging_defect', 'wrong_item'],
  stow: ['item_missing', 'product_defect', 'packaging_defect'],
};

export function isGenericProblemClassificationAllowed(source: unknown, exceptionType: unknown): boolean {
  if (typeof source !== 'string' || typeof exceptionType !== 'string') return false;
  return GENERIC_PROBLEM_CLASSIFICATIONS[source]?.includes(exceptionType) ?? false;
}

const MAX_PROBLEM_QUANTITY = 2_147_483_647;

export function isValidProblemQuantity(quantity: unknown): quantity is number {
  return (
    typeof quantity === 'number' &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    quantity <= MAX_PROBLEM_QUANTITY
  );
}
