import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

import { ConstraintType } from '../services/constraints/constraint.types.js';

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
  evaluations: { type: string; isActive: boolean }[]
) {

  const ofs = await trx('order_fulfillment_status')
    .where({ lasyncro_order_id: orderId })
    .first();

  if (!ofs) {
    throw new Error('[CONSTRAINT_PROJECTION_INVARIANT] fulfillment status missing');
  }

  const constraintMap: Record<string, boolean> = {};

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
    constraintMap[result.type] = result.isActive;
  }

  /**
   * Type-safe constraint iteration
   * ------------------------------
   * Object.entries widens keys to string.
   * We restore ConstraintType typing to guarantee
   * projection only emits valid constraint types.
   */
  for (const type of constraintTypes) {

  const isActive = constraintMap[type];

    const activeEvent = await trx('order_constraint_events')
      .where({
        lasyncro_order_id: orderId,
        constraint_type: type,
        is_active: true,
      })
      .first();

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

    if (isActive && !activeEvent) {

      const constraintEventId = uuidv5(
        `${type}:${orderId}:${aggregateVersion}`,
        CONSTRAINT_EVENT_NAMESPACE
      );

      await trx('order_constraint_events').insert({
        constraint_event_id: constraintEventId,
        lasyncro_order_id: orderId,
        shop_id: shopId,
        constraint_type: type,
        started_at: eventAnchor,
        resolved_at: null,
        is_active: true,
      });

    }

    if (!isActive && activeEvent) {

      await trx('order_constraint_events')
        .where({
          constraint_event_id: activeEvent.constraint_event_id
        })
        .update({
          resolved_at: eventAnchor,
          is_active: false,
        });

    }
  }
}