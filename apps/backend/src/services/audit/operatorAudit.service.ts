// apps/backend/src/services/audit/operatorAudit.service.ts
import { Knex } from 'knex';

/**
 * OPERATOR AUDIT SERVICE (AUD-01)
 * --------------------------------
 * Append-only audit trail for all operator actions.
 * Called from every state transition in the WMS pipeline.
 *
 * Never throws — audit failures must not block operational flow.
 * Errors are logged but swallowed.
 *
 * Usage:
 *   await writeAuditLog(trx, {
 *     shopId, operatorId,
 *     actionType: 'stow_confirm',
 *     entityType: 'stow_task',
 *     entityId: stowTaskId,
 *     metadata: { location_code, quantity },
 *   });
 */

export type AuditActionType =
  | 'receive_inspect'
  | 'receive_reconcile_finalize'
  | 'receive_close'
  | 'barcode_print'
  | 'stow_claim'
  | 'stow_assign'
  | 'stow_exception'
  | 'stow_confirm'
  | 'pick_claim'
  | 'pick_scan'
  | 'pick_complete'
  | 'pack_scan'
  | 'pack_complete'
  | 'ship_confirm'
  | 'exception_report'
  // ── Returns ──────────────────────────────────────────────
  | 'return_job_create'
  | 'return_job_claim'
  | 'return_line_process'
  | 'return_job_complete'
  | 'return_decision_set'
  | 'return_line_decision_set'
  // ── Inventory recount (INV-PHYSICAL-COUNT-13) ────────────
  | 'recount_create'
  | 'recount_claim'
  | 'recount_close'
  | 'recount_line_review'
  | 'recount_commit'
  // RECOUNT-CLAIM-ABANDONED-131: owner/admin explicit ownership recovery.
  | 'recount_reassign';
export type AuditEntityType =
  | 'receive_job'
  | 'stow_task'
  | 'pick_batch'
  | 'order'
  | 'variant'
  | 'return_job'
  | 'refund_execution_line_item'
  // ── Inventory recount (INV-PHYSICAL-COUNT-13) ────────────
  // Two grains, deliberately distinct: task-level actions
  // (create/claim/close/commit) audit the task; reviewLine
  // audits the individual line so a variance decision is
  // attributable to the specific SKU/bin it corrected, not
  // just the session. `operator_audit_log.entity_type` is
  // varchar with no enum/check, so no migration is required.
  | 'recount_task'
  | 'recount_line';

export interface WriteAuditLogInput {
  shopId: number;
  /**
   * DECISION RECORD (2026-07-04, RET-AUD service-layer task):
   * Widened to `number | null`. NULL means "no human operator" —
   * a system/webhook-triggered action (see
   * createReturnJobFromCarrierEvent in returnJobs.service.ts).
   * This mirrors the operator_audit_log.operator_id column being
   * relaxed to nullable in migration 0010 — see that migration's
   * inline comment for the full rationale and the deliberately
   * narrow scope (existing operator-facing call sites, e.g.
   * CreateUndeliveredReturnJobInput.operatorId, remain `number`,
   * required — this widening is for genuinely system-only actions,
   * not a general relaxation of operator attribution).
   */
  operatorId: number | null;
  actionType: AuditActionType;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(
  trx: Knex.Transaction,
  input: WriteAuditLogInput
): Promise<void> {
  try {
    await trx('operator_audit_log').insert({
      shop_id: input.shopId,
      operator_id: input.operatorId,
      action_type: input.actionType,
      entity_type: input.entityType,
      entity_id: input.entityId,
      metadata: JSON.stringify(input.metadata ?? {}),
      occurred_at: new Date(),
    });
  } catch (err) {
    // Audit failure must never block operational flow
    console.error('[AUDIT_LOG_FAILED]', {
      actionType: input.actionType,
      entityId: input.entityId,
      error: (err as Error).message,
    });
  }
}