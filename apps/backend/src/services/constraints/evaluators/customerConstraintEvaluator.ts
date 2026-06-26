// apps/backend/src/services/constraints/evaluators/customerConstraintEvaluator.ts
import { Knex } from 'knex';
import { ConstraintEvaluationResult } from '../constraint.types.js';

/**
 * CUSTOMER CONSTRAINT EVALUATOR
 * -----------------------------
 * Detects orders blocked by customer-side dependency.
 *
 * FIXED 2026-06-26 (was non-functional): previously read
 * order_fulfillment_status.customer_block_type, a column with zero writers
 * anywhere in the backend (confirmed by full-repo audit) — isActive could
 * never be derived, only circularly re-confirmed from an order_constraints
 * row that already existed. This also violated the constraint system
 * blueprint's own "Forbidden Pattern: ofs.customer_block_type" (see
 * docs/blueprints/constraint_system_blueprint.md, being reconciled
 * alongside this fix).
 *
 * Real, durable signal: orders.shipping_address* completeness. Populated
 * at order ingestion from the Shopify webhook payload
 * (shopify-to-canonical-order.ts), normalized across REST/GraphQL shapes.
 *
 * ARCHITECTURAL NOTE: laSyncro only ever receives the orders/paid webhook —
 * draft (pre-payment) orders are never visible to this system. Payment-
 * status-based signals (e.g. "awaiting_payment") are therefore not
 * possible here; address completeness is the correct real signal instead.
 *
 * Definition:
 * - blocked when address1, city, zip, or country_code is missing on a
 *   paid order — can't generate a shipping label without these.
 *
 * KNOWN LIMITATION (not yet handled, not silently assumed away):
 * - Shopify local-pickup orders legitimately have no shipping address.
 *   No requires_shipping/delivery_method field exists anywhere in this
 *   codebase today (confirmed by repo-wide search), so this evaluator
 *   cannot currently distinguish "incomplete address" from "pickup order,
 *   no address needed." If this or any shop enables local pickup, this
 *   will need a real fix, not a workaround bolted on here.
 *
 * Future extensions (real gaps, not yet built):
 * - delivery/address validation against a carrier API (not just presence)
 * - customer confirmation required
 */
export async function evaluateCustomerConstraint(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number
): Promise<ConstraintEvaluationResult> {
  /**
   * shopId accepted for interface consistency with the other evaluators;
   * tenant isolation is enforced via RLS, not a manual shop_id filter —
   * same pattern as evaluateInventoryConstraint.
   */
  const order = await trx('orders')
    .where({ lasyncro_order_id: orderId })
    .select('shipping_address1', 'shipping_city', 'shipping_zip', 'shipping_country_code')
    .first();

  const isIncompleteAddress =
    !order?.shipping_address1 ||
    !order?.shipping_city ||
    !order?.shipping_zip ||
    !order?.shipping_country_code;

  return {
    type: 'customer',
    isActive: isIncompleteAddress,
    meta: {
      blockType: isIncompleteAddress ? 'incomplete_address' : null
    }
  };
}