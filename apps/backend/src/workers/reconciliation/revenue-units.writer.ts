// apps/backend/src/workers/reconciliation/revenue-units.writer.ts
import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import crypto from 'crypto';

/**
 * Revenue Unit Writer (Variant-Aggregated Model)
 * ----------------------------------------------
 * Source: order_line_items
 *
 * Economic Model:
 * - Each row represents ONE variant within an order.
 * - Quantity is stored on the row (aggregated units).
 * - Identity: (lasyncro_order_id, lasyncro_variant_id)
 *
 * This is NOT a unit-atomic ledger.
 * If true unit-level economics are required in the future,
 * a separate `revenue_unit_ledger` must be introduced.
 *
 * Guarantees:
 * - Variant-level economic fidelity
 * - Deterministic replay safety
 * - Idempotent on (lasyncro_order_id, lasyncro_variant_id)
 */

const REVENUE_UNIT_NAMESPACE =
  '5f8b7f2e-5e3d-4a55-9f4b-3f7c6d8b91aa'; // fixed constant namespace

export async function writeOrderRevenueUnits(
  lasyncroOrderId: string,
  trx: Knex.Transaction
) {
  /**
   * TRANSACTION CONTRACT
   * --------------------
   * This function MUST participate in reconciliation transaction.
   * It MUST NOT open its own transaction.
   *
   * Caller is responsible for atomic boundary.
   */

    const order = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select([
        'order_processed_at',
        'order_created_at',
        'shop_id',
      ])
      .first();

    if (!order) {
      throw new Error(`[RevenueUnitWriter] Order not found: ${lasyncroOrderId}`);
    }

    const occurredAt =
      order.order_processed_at ?? order.order_created_at;

    /**
     * HISTORICAL COST SNAPSHOT
     * ------------------------
     * Cost is read from variants at reconciliation time ONLY
     * when revenue units are first created.
     *
     * During deterministic rebuild:
     * - existing revenue units are reused
     * - catalog cost changes must NOT affect past economics
     *
     * Invariant:
     * order_revenue_units.estimated_unit_cost is the historical truth.
     */

    /**
     * COST SNAPSHOT SOURCE
     * --------------------
     * Revenue unit economics are derived from the catalog cost
     * stored on variants.unit_cost at the moment revenue units
     * are first materialized.
     *
     * Important invariant:
     * - order_revenue_units.estimated_unit_cost becomes the
     *   immutable historical cost snapshot for that order.
     *
     * Determinism model:
     * - variants.unit_cost must exist (NOT NULL)
     * - revenue units snapshot cost once
     * - rebuilds must never recompute historical economics
     *
     * Therefore:
     * - catalog cost changes only affect FUTURE orders
     * - historical margins remain stable because the
     *   economic snapshot is stored in order_revenue_units
     */
    const rows = await trx('order_line_items as oli')
      .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oli.lasyncro_variant_id')
      .where({ 'oli.lasyncro_order_id': lasyncroOrderId })
      .orderBy('oli.lasyncro_variant_id', 'asc')
      .select(
        'oli.lasyncro_product_id',
        'oli.lasyncro_variant_id',
        'oli.sku',
        'oli.title',
        'oli.quantity',
        'oli.unit_price',
        'oli.line_total',
        trx.raw('v.unit_cost as estimated_unit_cost')
      );

    if (rows.length === 0) return;

    const invalid = rows.filter(r => !r.lasyncro_variant_id);
    if (invalid.length > 0) {
      throw new Error(
        `[RevenueUnitWriter] Missing lasyncro_variant_id for order ${lasyncroOrderId}`
      );
    }

    /**
     * OPERATIONAL VISIBILITY
     * ----------------------
     * This log allows operators to trace revenue-unit materialization
     * during reconciliation and deterministic rebuilds.
     *
     * Critical economic boundary:
     * - Creates revenue units
     * - Emits inventory ledger movements
     *
     * Absence of this log historically made reconciliation debugging opaque.
     */

    console.info('[REVENUE_UNITS_WRITE]', {
      orderId: lasyncroOrderId,
      variantCount: rows.length
    });

    const revenueUnits = rows.map((r) => ({
      lasyncro_revenue_unit_id: uuidv5(
        `${lasyncroOrderId}:${r.lasyncro_variant_id}`,
        REVENUE_UNIT_NAMESPACE
      ),
      lasyncro_order_id: lasyncroOrderId,
      lasyncro_product_id: r.lasyncro_product_id,
      lasyncro_variant_id: r.lasyncro_variant_id,
      sku: r.sku,
      title: r.title,
      quantity: r.quantity,
      unit_price: r.unit_price,
      line_total: r.line_total,
      estimated_unit_cost: r.estimated_unit_cost ?? null,
    }));

    /**
     * ECONOMIC SNAPSHOT GUARANTEE
     * ---------------------------
     * Once a revenue unit exists its economic attributes must NEVER change.
     *
     * Conflict strategy:
     * - If revenue unit already exists → DO NOTHING
     * - Existing estimated_unit_cost remains authoritative
     *
     * This prevents:
     * - historical margin mutation
     * - replay drift during deterministic rebuilds
     */
    await trx('order_revenue_units')
      .insert(revenueUnits)
      .onConflict(['lasyncro_order_id', 'lasyncro_variant_id'])
      .ignore();

    await trx('inventory_movements')
      .insert(
        revenueUnits.map((ru) => ({
          /**
           * DETERMINISTIC INVENTORY MOVEMENT ID
           * -----------------------------------
           * Inventory movements must be deterministic to allow
           * replay-safe rebuilds and stable system state hashing.
           *
           * Identity is derived from:
           * - revenue unit id
           * - movement type
           */
          lasyncro_inventory_movement_id: uuidv5(
            `${ru.lasyncro_revenue_unit_id}:inventory:sale`,
            REVENUE_UNIT_NAMESPACE
          ),
          device_event_id: uuidv5(
            `${ru.lasyncro_revenue_unit_id}:sale`,
            REVENUE_UNIT_NAMESPACE
          ),
          shop_id: order.shop_id,
          lasyncro_variant_id: ru.lasyncro_variant_id,
          movement_type: 'sale',
          quantity_delta: -ru.quantity,
          reference_type: 'order_revenue_unit',
          reference_id: ru.lasyncro_revenue_unit_id,
          platform: null,
          location_code: `WH-${order.shop_id}-ROOT`,
          occurred_at: occurredAt,
        }))
      )
      .onConflict(['device_event_id'])
      .ignore();
  };

