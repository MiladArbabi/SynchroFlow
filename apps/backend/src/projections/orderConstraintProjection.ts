import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

import { ConstraintType } from '../services/constraints/constraint.types.js';
import { ConstraintEvaluationResult } from '../services/constraints/constraint.types.js';

import { logConflictResolved } from '../conflict-resolution/conflict.logger.js';
import { ConflictTypes, ResolutionStrategies } from '../conflict-resolution/conflict.types.js';

import { debugLog } from '../projection/projection.utils.js';

/**
 * ARCHITECTURE CHANGE (EVENT SYSTEM REMOVED)
 * ------------------------------------------
 * order_constraint_events has been deprecated.
 *
 * Reason:
 * - Order-level event model incompatible with variant-scoped constraints
 * - Caused loss of constraints due to uniqueness conflicts
 *
 * New model:
 * - order_constraints is the single source of truth
 * - lifecycle managed directly via started_at / resolved_at
 */

/**
 * ORDER CONSTRAINT PROJECTION
 * ---------------------------
 * Maintains lifecycle of constraint events.
 *
 * Event model:
 * - open event when constraint detected
 * - close event when constraint resolved
 *
 * Deterministic guarantees:
 * - append-only lifecycle
 * - event-time anchored
 */

const CONSTRAINT_EVENT_NAMESPACE =
  'a9b7c6d4-4f8a-4c1b-b7b6-1c9a2e5d7f91';

/**
 * TYPE INVARIANT
 * --------------
 * shopId must always be numeric.
 *
 * Source of truth:
 * DB schema → shops.id INTEGER
 *
 * Using string here breaks:
 * - constraint engine interface
 * - database insert typing
 */
export async function projectOrderConstraints(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number,
  aggregateVersion: number,
  eventAnchor: Date,
  /**
   * ARCHITECTURAL INVARIANT
   * ------------------------
   * Constraint evaluation MUST occur in the reconciliation layer.
   * Projections are responsible only for materializing lifecycle events.
   */
  evaluations: ConstraintEvaluationResult[]
) {

  const ofs = await trx('order_fulfillment_status')
    .where({ lasyncro_order_id: orderId })
    .first();

  if (!ofs) {
    throw new Error('[CONSTRAINT_PROJECTION_INVARIANT] fulfillment status missing');
  }

  /**
   * VARIANT-SCOPED CONSTRAINT MAP
   * -----------------------------
   * Keyed by: constraint_type + targetId
   *
   * Prevents collapsing variant-level signals into order-level false positives.
   */
  const constraintMap: Record<string, ConstraintEvaluationResult[]> = {};

  /**
   * Canonical constraint type list
   * ------------------------------
   * Projection must iterate deterministically
   * across all constraint types to guarantee
   * proper constraint lifecycle resolution.
   */
  const constraintTypes: ConstraintType[] = [
    'inventory',
    'customer',
    'operational'
  ];

  for (const result of evaluations) {

    if (!constraintMap[result.type]) {
      constraintMap[result.type] = [];
    }

    constraintMap[result.type].push(result);
  }

  /**
   * Type-safe constraint iteration
   * ------------------------------
   * Object.entries widens keys to string.
   * We restore ConstraintType typing to guarantee
   * projection only emits valid constraint types.
   */
  for (const result of evaluations) {
    const type = result.type;
    const targetId = result.targetId ?? null;

    if (!targetId && type === 'inventory') {
      console.error('[CONSTRAINT_SCOPE_VIOLATION][LOOP]', {
        orderId,
        type,
        reason: 'evaluation missing targetId'
      });
    }

    /**
     * A constraint type is active ONLY if ANY scoped result is active
     */
    const isActive = result.isActive === true;

    /**
     * Runtime constraint type guard
     * -----------------------------
     * Protects database enum integrity in case
     * upstream evaluators introduce invalid types.
     */
    if (!['inventory','customer','operational'].includes(type)) {
      throw new Error(
        `[CONSTRAINT_TYPE_INVALID] Unexpected constraint type: ${type}`
      );
    }

    if (isActive) {

      /**
       * MULTI-WRITER DETECTION
       * ----------------------
       * Detects if multiple projections attempt to write same constraint.
       */
      const conflicting = await trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: type,
          target_id: targetId,
          is_active: true
        });

      if (conflicting.length > 1) {
        const conflictType = ConflictTypes.DATA_RACE;
        const resolutionStrategy = ResolutionStrategies.FAIL;

        logConflictResolved({
          entity: 'order_constraints',
          conflictKey: ['lasyncro_order_id', 'constraint_type', 'target_id'],
          conflictType,
          resolutionStrategy,
          note: `Multi-writer detected: ${conflicting.length} active constraints`
        });

        console.error('[CONSTRAINT_MULTI_WRITER_DETECTED]', {
          orderId,
          type,
          count: conflicting.length,
          sources: conflicting.map(c => c.write_source)
        });
      }

      if (!targetId && type === 'inventory') {
        console.error('[CONSTRAINT_SCOPE_VIOLATION][QUERY]', {
          orderId,
          type,
          reason: 'query executed without targetId'
        });
      }

      /**
       * SAFE UPSERT (PARTIAL INDEX COMPATIBLE)
       * -------------------------------------
       * Postgres cannot use partial index in ON CONFLICT.
       * We must manually upsert.
       */
      const existingConstraint = await trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: type,
          target_id: targetId,
          is_active: true
        })
        .first();

      if (!existingConstraint) {
        await trx('order_constraints').insert({
          /**
           * SCOPE INVARIANT
           * ----------------
           * target_id MUST be persisted to maintain variant-level constraint integrity.
           * Without this, system collapses to order-level blocking.
           */
          target_id: targetId,
          /**
           * WRITE ORIGIN TRACE
           * -------------------
           * Identifies which projection wrote this row.
           */
          write_source: 'orderConstraintProjection',
          constraint_id: uuidv5(
            /**
             * IDENTITY INVARIANT
             * ------------------
             * constraint_id must represent a stable constraint scope:
             * (order_id + type + target_id)
             *
             * MUST NOT include aggregateVersion.
             *
             * Including version causes:
             * - duplicate rows
             * - broken upsert logic
             * - unbounded growth
             */
            `constraint:${type}:${orderId}:${targetId}`,
            CONSTRAINT_EVENT_NAMESPACE
          ),
          lasyncro_order_id: orderId,
          constraint_type: type,
          block_type: result.meta?.blockType ?? null,
          started_at: eventAnchor,
          resolved_at: null,
          is_active: true,
          created_at: new Date()
        });

        /**
         * TEMP BRIDGE: WRITE TO order_constraint_events (ACTIVE)
         * ------------------------------------------------------
         * Required because downstream systems still depend on this table.
         */
        await trx('order_constraint_events')
          .insert({
            /**
             * PRIMARY KEY (REQUIRED)
             */
            constraint_event_id: uuidv5(
              `constraint-event:${type}:${orderId}:${targetId}`,
              CONSTRAINT_EVENT_NAMESPACE
            ),

            /**
             * TENANT BOUNDARY (REQUIRED)
             */
            shop_id: shopId,

            lasyncro_order_id: orderId,
            constraint_type: type,
            target_id: targetId,

            is_active: true,
            started_at: eventAnchor,
            evaluated_at: eventAnchor,
            aggregate_version: aggregateVersion,

            created_at: trx.fn.now(),
            updated_at: trx.fn.now()
          })

          debugLog('[CONSTRAINT_EVENT_INSERTED]', {
            orderId,
            type,
            targetId
          });

      } else {
        await trx('order_constraints')
          .where({ constraint_id: existingConstraint.constraint_id })
          .update({
            /**
             * SCOPE INVARIANT (WRITE-THROUGH)
             * --------------------------------
             * target_id must always be persisted on update to avoid scope drift.
             */
            target_id: targetId,
            block_type: result.meta?.blockType ?? null,
            started_at: eventAnchor,
            resolved_at: null,
            is_active: true,

            /**
             * WRITE ORIGIN TRACE
             */
            write_source: 'orderConstraintProjection'
          });

      /**
       * TEMP BRIDGE: WRITE TO order_constraint_events (RESOLVED)
       * --------------------------------------------------------
       * Keeps legacy consumers in sync until full migration.
       */
      await trx('order_constraint_events')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: type,
          target_id: targetId
        })
        .update({
          is_active: false,
          evaluated_at: eventAnchor,
          aggregate_version: aggregateVersion,
          updated_at: trx.fn.now()
        });
      }



    }

    if (!isActive) {

      if (!targetId && type === 'inventory') {
        console.error('[CONSTRAINT_SCOPE_VIOLATION][RESOLUTION]', {
          orderId,
          type,
          reason: 'missing targetId during resolution'
        });
      }

      /**
       * UNIFIED CONSTRAINT MODEL WRITE (RESOLUTION)
       * ------------------------------------------
       */
      await trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: type,
          target_id: targetId,
          is_active: true
        })
        .update({
          resolved_at: eventAnchor,
          is_active: false,

          /**
           * WRITE ORIGIN TRACE
           */
          write_source: 'orderConstraintProjection'
        });

        /**
         * ARCHITECTURE RULE
         * ------------------
         * Projections must NEVER enqueue reconciliation intents.
         *
         * Control flow is strictly event-driven.
         * Allowing projections to enqueue intents creates feedback loops
         * and breaks rebuild determinism.
         */
    }
  }
}