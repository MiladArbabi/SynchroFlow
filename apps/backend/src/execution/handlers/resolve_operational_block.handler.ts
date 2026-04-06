/**
 * resolve_operational_block HANDLER
 * ---------------------------------
 * Resolves an operational constraint for an order.
 *
 * ACTIONS:
 * 1. Mark the operational constraint inactive in order_constraints
 * 2. Schedule snapshot recomputation via shop_snapshot_jobs
 *
 * INVARIANTS:
 * - Idempotent: re-running against an already-inactive constraint is safe
 * - Uses injected trx for atomicity with execution worker lifecycle
 * - shop_snapshot_jobs uses onConflict merge — safe to call multiple times
 */
import db from '@lasyncro/backend-core/db.js';
import { ExecutionHandler } from '../execution.registry.js';

export const resolveOperationalBlockHandler: ExecutionHandler = async (job, trx) => {
  const dbx = trx ?? db;

  console.info('[HANDLER_EXECUTION_START]', {
    action: 'resolve_operational_block',
    decision_id: job.decision_id,
    entity_id: job.entity_id,
    shop_id: job.shop_id,
  });

  /**
   * STEP 1 — DEACTIVATE OPERATIONAL CONSTRAINT
   * -------------------------------------------
   * Marks all active operational constraints for this order as resolved.
   *
   * Source of truth: order_constraints (canonical per handover architecture rules)
   * resolved_at: set to now() for audit trail
   */
  const updated = await dbx('order_constraints')
    .where({
      lasyncro_order_id: job.entity_id,
      constraint_type: 'operational',
      is_active: true,
    })
    .update({
      is_active: false,
      resolved_at: dbx.fn.now(),
    });

  console.info('[OPERATIONAL_CONSTRAINT_RESOLVED]', {
    decision_id: job.decision_id,
    entity_id: job.entity_id,
    constraints_deactivated: updated,
  });

  /**
   * STEP 2 — SCHEDULE SNAPSHOT RECOMPUTATION
   * -----------------------------------------
   * Triggers the snapshot dispatcher to recompute the operational
   * control snapshot reflecting the resolved constraint.
   *
   * onConflict merge: safe to call multiple times — deduplicates
   * to one pending job per shop.
   */
  await dbx('shop_snapshot_jobs')
    .insert({
      shop_id: job.shop_id,
      scheduled_at: dbx.fn.now(),
    })
    .onConflict(['shop_id'])
    .merge({
      scheduled_at: dbx.fn.now(),
    });

  console.info('[SNAPSHOT_RECOMPUTE_SCHEDULED]', {
    decision_id: job.decision_id,
    shop_id: job.shop_id,
  });
};