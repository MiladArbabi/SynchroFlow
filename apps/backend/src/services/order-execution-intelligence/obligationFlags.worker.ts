import db from 'api-src/db';

/**
 * Obligation Flag Worker (L2)
 * --------------------------
 * Writes obligation signals onto execution rows.
 *
 * Contract:
 * - Reads ONLY canonical + execution facts
 * - Writes ONLY obligation flags
 * - Never infers fulfillment or revenue
 *
 * This worker is SAFE to rerun.
 */

/**
 * OBLIGATION SCHEMA — LOCKED (v1)
 * --------------------------------
 * has_inventory_block     → deterministic, inventory_truth based
 * has_customer_block      → reserved (NULL unless explicitly set)
 * has_operational_block   → reserved
 * has_other_block         → reserved
 *
 * Rules:
 * - NULL = not evaluated / not applicable
 * - false = explicitly evaluated, no block
 * - true  = explicitly blocked
 *
 * No worker may write flags it does not fully own.
 */

export async function computeObligationFlags(shopId: number): Promise<void> {
  /**
     * Inventory Block v1
     * ------------------
     * An order is inventory-blocked if ANY line item SKU
     * has net available inventory <= 0.
     *
     * Net availability is defined canonically as:
     * quantity_available - quantity_reserved - quantity_buffer
     *
     * IMPORTANT:
     * - Missing inventory rows do NOT imply a block
     * - This is a hard availability check, not forecasting
     * - SKU-based only (no product / variant inference)
     */
    const inventoryRows = await db('canonical_order_line_items as li')
    .leftJoin(
        'inventory_truth as it',
        function () {
        this.on('it.sku', '=', 'li.sku')
            .andOn('it.shop_id', '=', 'li.shop_id');
        }
    )
    .where('li.shop_id', shopId)
    .select(
        'li.canonical_order_id',
        'it.quantity_available',
        'it.quantity_reserved',
        'it.quantity_buffer'
    );

    const inventoryBlockedOrders = new Set<string>();

    for (const row of inventoryRows) {
    if (
        row.quantity_available == null ||
        row.quantity_reserved == null ||
        row.quantity_buffer == null
    ) {
        // Inventory unknown → epistemically unknown, NOT blocked
        continue;
    }

    const netAvailable =
        row.quantity_available -
        row.quantity_reserved -
        row.quantity_buffer;

    if (netAvailable <= 0) {
        inventoryBlockedOrders.add(row.canonical_order_id);
    }
    }
  
  /**
   * Customer obligation (placeholder)
   * ---------------------------------
   * Future: payment failures, address issues, etc.
   *
   * For now:
   * - No signal → leave NULL
   */

    /**
     * Persist inventory obligation flags
     * ----------------------------------
     * - Writes ONLY has_inventory_block
     * - Leaves other obligation flags untouched
     * - Idempotent by canonical_order_id
     *
     * IMPORTANT:
     * - TRUE  → inventory block present
     * - FALSE → explicitly not blocked
     * - NULL  → epistemically unknown (no inventory signal)
     */
    if (inventoryBlockedOrders.size > 0) {
        await db('order_fulfillment_status')
        .where('shop_id', shopId)
        .whereIn(
            'canonical_order_id',
            Array.from(inventoryBlockedOrders)
        )
        .update({
            has_inventory_block: true,
        });
    }

    /**
     * Explicitly clear inventory block
     * --------------------------------
     * Orders evaluated and NOT blocked
     * must be marked as false (not NULL),
     * otherwise reruns accumulate ambiguity.
     */
    await db('order_fulfillment_status')
        .where('shop_id', shopId)
        .whereNotIn(
        'canonical_order_id',
        Array.from(inventoryBlockedOrders)
        )
        .update({
        has_inventory_block: false,
        });

  // Explicit no-op by design
  return;
}