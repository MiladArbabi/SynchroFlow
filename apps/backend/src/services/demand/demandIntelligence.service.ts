// apps/backend/src/services/demand/demandIntelligence.service.ts

import type { Knex } from 'knex';
import db from '@lasyncro/backend-core/db.js';
import { pickableLocationCondition } from '../inventory/pickableLocation.js';
import { resolveEffectivePolicy as resolveEffectiveStockProtectionPolicy } from '../inventory/stockProtectionPolicyResolution.js';
import {
  RELIABLE_INBOUND_PO_STATUSES,
  STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES,
} from '../inventory/purchaseOrderStatusGroups.js';
import {
  getActiveReplenishmentEvidence,
  type ActiveReplenishmentEvidence,
} from '../inventory/replenishmentEvidence.js';

/**
 * DEMAND INTELLIGENCE SERVICE (DF-01, DF-02, DF-03 / SRC-11)
 * ------------------------------------------------------------
 * Computes fulfilled-demand velocity, days of stock, demand confidence,
 * replenishment urgency, and suggested reorder quantity per variant.
 *
 * METHODOLOGY:
 * - Demand uses fulfilled_quantity, not ordered quantity.
 * - Velocity uses the shortest sufficiently populated 30d → 90d → 180d
 *   window. Sparse fulfilled demand falls back to 180d instead of zero.
 * - Confidence is separate from replenishment urgency.
 * - Days of stock = aggregated available_quantity / velocity.
 * - Stockout is always critical.
 * - Critical when days_of_stock <= supplier lead_time_days.
 * - Warning when days_of_stock <= lead_time_days + safety_days.
 * - Missing lead time produces planning_data_required instead of guessing.
 * - Suggested reorder quantity targets:
 *     velocity × (lead time + safety days + purchasing cycle)
 *     + open customer demand
 *     - available stock
 *     - reliable future inbound.
 *
 * SOURCES:
 * - order_revenue_units.fulfilled_quantity → fulfilled units per variant
 * - order_fulfillment_status → fulfillment timing and terminal order state
 * - inventory_truth → available stock summed across warehouse locations
 * - suppliers.lead_time_days → canonical supplier planning lead time
 * - purchase_orders / purchase_order_line_items → reliable future inbound
 * - products / variants → physical + active eligibility
 *
 * CURRENT LIMITATIONS / DEFAULTS:
 * - fulfilled_at is order-level truth; partial line-level fulfillment timing
 *   is not modeled and must not be inferred.
 * - Safety days use an explicit 5-day system default until configurable
 *   SKU/supplier/shop policy fields exist.
 * - Purchasing cycle uses an explicit 7-day system default until
 *   configurable supplier/shop policy fields exist.
 * - shipped / partially_received POs are at the receiving boundary and are
 *   not counted as future reliable inbound.
 *
 * RULES:
 * - Read-only demand computation.
 * - Shop-scoped — always filters by shop_id.
 * - Eligible variants are physical, active products with active variants.
 */

export type DemandVelocity = {
  lasyncro_variant_id: string;
  title: string | null;
  sku: string | null;
  product_title: string | null;
  unit_cost: number | null;
  available_quantity: number;
  units_sold_30d: number;
  units_sold_prev_30d: number;
  units_sold_all_time: number;
  velocity_per_day: number;
  velocity_window_days: 30 | 90 | 180;
  demand_confidence: 'high' | 'medium' | 'low' | 'none';
  /** 'up' = >10% increase vs prior period, 'down' = >10% decrease, 'stable' = within 10% */
  velocity_trend: 'up' | 'down' | 'stable';
  days_of_stock_remaining: number | null;
  reorder_signal: boolean;
  reorder_urgency: 'critical' | 'warning' | 'healthy' | 'planning_data_required' | 'no_velocity';
  estimated_stockout_date: string | null;
  /**
   * Suggested units to order:
   * velocity × (lead time + safety + purchasing cycle)
   * + open demand - available stock - reliable inbound.
   * Null when supplier planning lead time is not configured.
   */
  suggested_reorder_qty: number | null;
  /** Supplier-configured planning lead time — null when not configured */
  supplier_lead_time_days: number | null;
  /**
   * STOCK-PROTECT-02: the identity behind supplier_lead_time_days — the
   * approved policy's anchored supplier when one is set, otherwise the
   * variant's most-recent-PO supplier (same resolution as
   * supplier_lead_time_days itself). Null when neither exists. Exposed so a
   * downstream evidence reader can identify which supplier's reliability to
   * evaluate without reimplementing this selection.
   */
  planning_supplier_id: number | null;
  /**
   * Days of demand the suggestion is sized to cover:
   * lead time + safety days + purchasing cycle. Returned so consumers can
   * state the figure without restating the system defaults, which would
   * duplicate a constant that can silently go stale.
   */
  target_coverage_days: number | null;
};

export type DemandSummary = {
  total_variants_tracked: number;
  critical_reorder_count: number;
  warning_reorder_count: number;
  stockout_count: number;
  avg_days_of_stock: number | null;
  total_inventory_value: number;
};

export type DemandIntelligenceResult = {
  summary: DemandSummary;
  variants: DemandVelocity[];
  computed_at: string;
};

/**
 * STOCK-PROTECT-03: opt-in candidate-set eligibility contract.
 * ----------------------------------------------------------------
 * 'legacy' (default): exact existing behavior — candidate set is
 * INNER-JOIN-anchored on inventory_truth, then the trailing
 * units_sold_all_time>0||available_quantity>0 filter. Every existing caller
 * that omits `options` keeps this behavior unchanged.
 *
 * 'stock_protection': candidate set is anchored on active+physical
 * variants/products (LEFT JOIN inventory_truth), and a variant is eligible
 * when ANY of: pickable stock>0, historical fulfilled demand>0, open
 * customer demand>0, an approved Stock Protection policy exists, a pending
 * reorder_request exists, or a PO status intersects
 * STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES (draft/shipped/partially_received
 * — NOT ordered/confirmed/in_production, which are pure supplier-side wait
 * state and must never independently wake a dormant SKU).
 */
export type PlanningEligibilityMode = 'legacy' | 'stock_protection';

export interface ComputeVariantPlanningOptions {
  eligibilityMode?: PlanningEligibilityMode;
  /**
   * Stock Protection mode only. When supplied, reused as-is — zero
   * additional replenishment-evidence queries run. When omitted (and mode
   * is 'stock_protection'), this function loads it itself via
   * getActiveReplenishmentEvidence (standalone-caller fallback). Ignored
   * entirely in 'legacy' mode, which never queries replenishment evidence.
   */
  replenishmentEvidence?: ActiveReplenishmentEvidence;
}

const VELOCITY_WINDOW_DAYS = 30;
const MEDIUM_VELOCITY_WINDOW_DAYS = 90;
const MAX_VELOCITY_WINDOW_DAYS = 180;
const MIN_FULFILLMENT_EVENTS = 3;

/**
 * STOCK-PROTECT-01: safety_days is no longer a fixed system constant here.
 * The no-policy default (5) is now owned by
 * stockProtectionPolicyResolution.ts (resolveEffectivePolicy(null)) — the
 * single source of truth for legacy fallback behaviour — and the effective,
 * per-variant value (approved policy or that same default) is threaded in
 * below as `effectiveSafetyDays`.
 */
function deriveUrgency(
  daysOfStock: number | null,
  velocityPerDay: number,
  availableQty: number,
  leadTimeDays: number | null,
  effectiveSafetyDays: number
): 'critical' | 'warning' | 'healthy' | 'planning_data_required' | 'no_velocity' {
  if (availableQty <= 0) return 'critical';

  if (velocityPerDay === 0 || daysOfStock === null) {
    return 'no_velocity';
  }

  if (leadTimeDays === null) {
    return 'planning_data_required';
  }

  if (daysOfStock <= leadTimeDays) return 'critical';
  if (daysOfStock <= leadTimeDays + effectiveSafetyDays) return 'warning';

  return 'healthy';
}


/**
 * PER-VARIANT REPLENISHMENT PLANNING (SRC-12)
 * -------------------------------------------
 * Pure planning arithmetic: gathers demand history, supplier lead time, open
 * demand, reliable inbound and inventory, then derives velocity, confidence,
 * urgency and suggested reorder quantity per variant.
 *
 * Extracted from computeDemandIntelligence so Sourcing can reach the SAME
 * trusted numbers that power the Demand module. Two subsystems previously
 * answered "how much should I order" and only the weaker, reactive one was
 * wired to the PO-creating surface.
 *
 * Takes a caller-supplied transaction: the caller owns the tenant scope
 * (SET LOCAL app.current_tenant) and the transaction lifetime.
 *
 * WRITES NOTHING. Alert reconciliation stays in computeDemandIntelligence so
 * a read-path caller (Sourcing) cannot trigger write side-effects.
 *
 * @param variantIds optional filter; omit for the whole catalogue.
 */
export async function computeVariantPlanning(
  trx: Knex.Transaction,
  shopId: number,
  variantIds?: string[],
  options?: ComputeVariantPlanningOptions
): Promise<DemandVelocity[]> {
    const eligibilityMode: PlanningEligibilityMode = options?.eligibilityMode ?? 'legacy';

    const window30Start = new Date();
    window30Start.setDate(window30Start.getDate() - VELOCITY_WINDOW_DAYS);

    const window60Start = new Date();
    window60Start.setDate(window60Start.getDate() - VELOCITY_WINDOW_DAYS * 2);

    const window90Start = new Date();
    window90Start.setDate(window90Start.getDate() - MEDIUM_VELOCITY_WINDOW_DAYS);

    const window180Start = new Date();
    window180Start.setDate(window180Start.getDate() - MAX_VELOCITY_WINDOW_DAYS);

    /**
     * ADAPTIVE FULFILLED-DEMAND HISTORY
     * ---------------------------------
     * Demand means units that actually left the warehouse, not units merely
     * ordered. The shortest window with >=3 fulfilled orders wins:
     * 30d -> 90d -> 180d. Sparse long-tail demand still uses 180d instead of
     * collapsing to zero.
     *
     * order_fulfillment_status.fulfilled_at is currently order-level truth;
     * line-level partial-fulfillment timestamps do not exist in the schema.
     */
    const demandHistory: any[] = await trx('order_revenue_units as oru')
      .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
      .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'oru.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .modify((qb: Knex.QueryBuilder) => { if (variantIds?.length) qb.whereIn('oru.lasyncro_variant_id', variantIds); })
      .whereNotNull('ofs.fulfilled_at')
      .where('ofs.fulfilled_at', '>=', window180Start)
      .groupBy('oru.lasyncro_variant_id')
      .select(
        'oru.lasyncro_variant_id',
        trx.raw(
          'COALESCE(SUM(oru.fulfilled_quantity) FILTER (WHERE ofs.fulfilled_at >= ?), 0) as units_30d',
          [window30Start]
        ),
        trx.raw(
          'COALESCE(SUM(oru.fulfilled_quantity) FILTER (WHERE ofs.fulfilled_at >= ? AND ofs.fulfilled_at < ?), 0) as units_prev_30d',
          [window60Start, window30Start]
        ),
        trx.raw(
          'COALESCE(SUM(oru.fulfilled_quantity) FILTER (WHERE ofs.fulfilled_at >= ?), 0) as units_90d',
          [window90Start]
        ),
        trx.raw(
          'COALESCE(SUM(oru.fulfilled_quantity), 0) as units_180d'
        ),
        trx.raw(
          'COUNT(DISTINCT oru.lasyncro_order_id) FILTER (WHERE ofs.fulfilled_at >= ? AND oru.fulfilled_quantity > 0) as events_30d',
          [window30Start]
        ),
        trx.raw(
          'COUNT(DISTINCT oru.lasyncro_order_id) FILTER (WHERE ofs.fulfilled_at >= ? AND oru.fulfilled_quantity > 0) as events_90d',
          [window90Start]
        ),
        trx.raw(
          'COUNT(DISTINCT oru.lasyncro_order_id) FILTER (WHERE oru.fulfilled_quantity > 0) as events_180d'
        )
      );

    const demandHistoryMap = new Map(
      demandHistory.map((r: any) => [
        r.lasyncro_variant_id,
        {
          units30d: Number(r.units_30d),
          unitsPrev30d: Number(r.units_prev_30d),
          units90d: Number(r.units_90d),
          units180d: Number(r.units_180d),
          events30d: Number(r.events_30d),
          events90d: Number(r.events_90d),
          events180d: Number(r.events_180d),
        },
      ])
    );

    /**
     * SUPPLIER PLANNING LEAD TIME PER VARIANT
     * ---------------------------------------
     * Use the supplier configured on the variant's most recent PO.
     * lead_time_days is planning truth; avg_delivery_days is observed supplier
     * performance and must not silently replace it.
     */
    const supplierLeadTime: any[] = await trx('purchase_order_line_items as poli')
      .join('purchase_orders as po', 'po.id', 'poli.po_id')
      .join('suppliers as s', 's.id', 'po.supplier_id')
      .where('poli.shop_id', shopId)
      .modify((qb: Knex.QueryBuilder) => { if (variantIds?.length) qb.whereIn('poli.lasyncro_variant_id', variantIds); })
      .whereNotNull('poli.lasyncro_variant_id')
      .distinctOn('poli.lasyncro_variant_id')
      .select(
        'poli.lasyncro_variant_id',
        's.lead_time_days',
        's.id as supplier_id',
      )
      .orderBy('poli.lasyncro_variant_id')
      .orderBy('po.created_at', 'desc');

    const supplierLeadTimeMap = new Map(
      supplierLeadTime.map((r: any) => [
        r.lasyncro_variant_id,
        r.lead_time_days !== null ? Number(r.lead_time_days) : null,
      ])
    );

    // STOCK-PROTECT-02: same most-recent-PO supplier identity used to derive
    // supplierLeadTimeMap above, kept as a separate map so the id is
    // available even for variants whose supplier HAS a configured
    // lead_time_days of null (supplierLeadTimeMap intentionally collapses
    // that case to null, losing the id).
    const legacySupplierIdMap = new Map<string, number>(
      supplierLeadTime.map((r: any) => [r.lasyncro_variant_id, Number(r.supplier_id)])
    );

    /**
     * STOCK-PROTECT-01: APPROVED STOCK PROTECTION POLICY PER VARIANT
     * ----------------------------------------------------------------
     * Read-only. Never mutates stock_protection_policies / writes a
     * transition — that boundary belongs exclusively to
     * stockProtectionPolicy.service.ts (upsertStockProtectionPolicy). This
     * demand recomputation may change derived buffer/reorder-quantity/
     * urgency output every time it runs; it must never change or version
     * the approved policy that produced those inputs.
     *
     * When an approved policy anchors an explicit planning_supplier_id, that
     * supplier's lead_time_days is authoritative and a newer PO from a
     * different supplier must not override it (contract item 11). An
     * anchored supplier that is missing or inactive is never silently
     * substituted — it resolves to leadTimeDays=null below, which the
     * existing deriveUrgency/targetCoverageDays logic already turns into
     * 'planning_data_required' rather than a guess (contract item 12/14).
     */
    const policyRows: any[] = await trx('stock_protection_policies')
      .where('shop_id', shopId)
      .modify((qb: Knex.QueryBuilder) => { if (variantIds?.length) qb.whereIn('lasyncro_variant_id', variantIds); })
      .select('lasyncro_variant_id', 'version', 'safety_days', 'review_cycle_days', 'planning_supplier_id');

    const policyMap = new Map(policyRows.map((r: any) => [r.lasyncro_variant_id, r]));

    const anchoredSupplierIds = Array.from(
      new Set(policyRows.map((r: any) => r.planning_supplier_id).filter((id: any) => id !== null))
    );
    const anchoredSupplierRows: any[] = anchoredSupplierIds.length
      ? await trx('suppliers')
          .whereIn('id', anchoredSupplierIds)
          .andWhere('shop_id', shopId)
          .select('id', 'active', 'lead_time_days')
      : [];
    const anchoredSupplierMap = new Map(anchoredSupplierRows.map((r: any) => [r.id, r]));

    /**
     * OPEN CUSTOMER DEMAND
     */
    const openDemandRows: any[] = await trx('order_revenue_units as oru')
      .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
      .join(
        'order_fulfillment_status as ofs',
        'ofs.lasyncro_order_id',
        'oru.lasyncro_order_id'
      )
      .where('o.shop_id', shopId)
      .whereNotIn('ofs.status', ['fulfilled', 'cancelled'])
      .modify((qb: Knex.QueryBuilder) => { if (variantIds?.length) qb.whereIn('oru.lasyncro_variant_id', variantIds); })
      .whereNotNull('oru.lasyncro_variant_id')
      .groupBy('oru.lasyncro_variant_id')
      .select(
        'oru.lasyncro_variant_id',
        trx.raw(
          'SUM(oru.quantity - oru.fulfilled_quantity) as open_demand'
        )
      );

    const openDemandMap = new Map(
      openDemandRows.map((r: any) => [
        r.lasyncro_variant_id,
        Number(r.open_demand ?? 0),
      ])
    );

    /**
     * RELIABLE FUTURE INBOUND
     * Draft is not committed. shipped/partially_received are already at the
     * receiving boundary in this lifecycle, so only pre-arrival committed
     * PO states contribute remaining inbound quantity.
     *
     * SRC-18a: rows carry days_out so the per-variant loop can window them.
     * Previously this was summed here and subtracted in full, which made a
     * time-bounded question (how much do I need for the next N days) answered
     * with an unbounded quantity: a PO landing in 90 days suppressed a reorder
     * needed in 20 exactly as hard as one landing tomorrow.
     *
     * Grouped-to-detailed is deliberate. targetCoverageDays depends on the
     * variant's own supplier lead time, so the window cannot be applied here —
     * it is not one horizon, it is one per variant.
     */
    const reliableInboundRows: any[] = await trx('purchase_order_line_items as poli')
      .join('purchase_orders as po', 'po.id', 'poli.po_id')
      .where('po.shop_id', shopId)
      .whereIn('po.status', [...RELIABLE_INBOUND_PO_STATUSES])
      .modify((qb: Knex.QueryBuilder) => { if (variantIds?.length) qb.whereIn('poli.lasyncro_variant_id', variantIds); })
      .whereNotNull('poli.lasyncro_variant_id')
      .select(
        'poli.lasyncro_variant_id',
        trx.raw(`
          GREATEST(
            poli.quantity_ordered - COALESCE(poli.quantity_received, 0),
            0
          ) as remaining_qty
        `),
        trx.raw(`
          CASE
            WHEN po.expected_delivery_date IS NULL THEN NULL
            ELSE (po.expected_delivery_date - CURRENT_DATE)
          END as days_out
        `)
      );

    /**
     * SRC-18a: null days_out means no ETA was recorded. The manual PO creation
     * path (suppliers.controller.ts) writes expected_delivery_date ?? null,
     * unlike the reorder-conversion path which derives one. Null is treated as
     * IN WINDOW: excluding it would drop real committed stock and inflate the
     * suggestion, which is the worse failure. This fix can therefore only ever
     * subtract LESS inbound than before — it can raise a suggestion, never
     * suppress one that fires today.
     */
    const reliableInboundMap = new Map<string, Array<{ qty: number; daysOut: number | null }>>();
    for (const r of reliableInboundRows) {
      const list = reliableInboundMap.get(r.lasyncro_variant_id) ?? [];
      list.push({
        qty: Number(r.remaining_qty ?? 0),
        daysOut: r.days_out === null ? null : Number(r.days_out),
      });
      reliableInboundMap.set(r.lasyncro_variant_id, list);
    }

    /**
     * ALL-TIME UNITS SOLD PER VARIANT
     */
    const allTimeSales: any[] = await trx('order_revenue_units as oru')
      .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .modify((qb: Knex.QueryBuilder) => { if (variantIds?.length) qb.whereIn('oru.lasyncro_variant_id', variantIds); })
      .groupBy('oru.lasyncro_variant_id')
      .select(
        'oru.lasyncro_variant_id',
        trx.raw('SUM(oru.fulfilled_quantity) as units_sold_all_time'),
      );

    const allTimeSalesMap = new Map(
      allTimeSales.map((r: any) => [r.lasyncro_variant_id, Number(r.units_sold_all_time)])
    );

    /**
     * INVENTORY TRUTH + VARIANT DETAILS
     * ---------------------------------
     * STOCK-PROTECT-01 (contract item 10 / SP-POL-12): availability is
     * fulfillment-consistent, not location-blind. Joins warehouse_locations
     * and reuses the SAME canonical pickableLocationCondition() predicate as
     * batchReservation.service.ts / the constraint evaluator, rather than a
     * second copy of the pick/warehouse zone_type condition. Receive,
     * returns, pack, ship, kitting, problem, and quarantine stock are real
     * stock but not sellable-from, and stay excluded exactly as they do for
     * pick allocation.
     *
     * STOCK-PROTECT-03: 'legacy' mode keeps this exact INNER-JOIN-on-
     * inventory_truth query, unchanged. 'stock_protection' mode anchors from
     * active+physical variants/products instead and LEFT JOINs
     * inventory_truth (+ pickable warehouse_locations), so a variant with NO
     * inventory_truth row still appears with available_quantity=0 — the same
     * COALESCE-to-zero pattern already used by
     * inventoryConstraintEvaluator.ts and products.catalog.controller.ts for
     * this same table. Non-pickable-only stock still nets to 0 via the
     * `FILTER (WHERE wl.location_code IS NOT NULL)` guard, exactly mirroring
     * the constraint evaluator's proven aggregation shape.
     */
    const inventoryRows: any[] =
      eligibilityMode === 'stock_protection'
        ? await trx('variants as v')
            .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
            .leftJoin('inventory_truth as it', function () {
              this.on('it.lasyncro_variant_id', '=', 'v.lasyncro_variant_id')
                .andOn('it.shop_id', '=', trx.raw('?', [shopId]));
            })
            .leftJoin('warehouse_locations as wl', function () {
              this.on('wl.location_code', '=', 'it.location_code')
                .andOn('wl.shop_id', '=', trx.raw('?', [shopId]))
                .andOnVal('wl.active', true)
                .andOn(pickableLocationCondition(trx));
            })
            .where('v.shop_id', shopId)
            .modify((qb: Knex.QueryBuilder) => { if (variantIds?.length) qb.whereIn('v.lasyncro_variant_id', variantIds); })
            .andWhere('p.product_type', 'physical')
            .andWhere('p.status', 'active')
            .andWhere('v.status', 'active')
            .groupBy(
              'v.lasyncro_variant_id',
              'v.title',
              'v.unit_cost',
              'v.sku',
              'p.title'
            )
            .select(
              'v.lasyncro_variant_id',
              trx.raw(
                "COALESCE(SUM(it.available_quantity) FILTER (WHERE wl.location_code IS NOT NULL), 0)::integer as available_quantity"
              ),
              'v.title',
              'v.unit_cost',
              trx.raw('COALESCE(v.sku, NULL) as sku'),
              'p.title as product_title',
            )
        : await trx('inventory_truth as it')
            .join('warehouse_locations as wl', function () {
              this.on('wl.location_code', '=', 'it.location_code')
                .andOn('wl.shop_id', '=', trx.raw('?', [shopId]))
                .andOnVal('wl.active', true)
                .andOn(pickableLocationCondition(trx));
            })
            .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
            .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
            .where('it.shop_id', shopId)
            .modify((qb: Knex.QueryBuilder) => { if (variantIds?.length) qb.whereIn('it.lasyncro_variant_id', variantIds); })
            .andWhere('p.product_type', 'physical')
            .andWhere('p.status', 'active')
            .andWhere('v.status', 'active')
            .groupBy(
              'it.lasyncro_variant_id',
              'v.title',
              'v.unit_cost',
              'v.sku',
              'p.title'
            )
            .select(
              'it.lasyncro_variant_id',
              trx.raw('SUM(it.available_quantity)::integer as available_quantity'),
              'v.title',
              'v.unit_cost',
              trx.raw('COALESCE(v.sku, NULL) as sku'),
              'p.title as product_title',
            );

    /**
     * STOCK-PROTECT-03: raw replenishment evidence for 'stock_protection'
     * eligibility signals E (pending reorder_request) and F (draft/
     * shipped/partially_received PO). 'legacy' mode NEVER calls this —
     * zero replenishment-evidence queries for any existing caller.
     * Reuses a caller-supplied snapshot when present (evaluateStockProtection
     * ForShop's single-canonical-read invariant); loads it itself only as a
     * standalone-caller fallback.
     */
    const replenishmentEvidence: ActiveReplenishmentEvidence | null =
      eligibilityMode === 'stock_protection'
        ? options?.replenishmentEvidence ?? await getActiveReplenishmentEvidence(trx, shopId, variantIds)
        : null;

    /**
     * BUILD PER-VARIANT DEMAND RECORDS
     * Only include variants that have had sales or have stock
     */
    const variants: DemandVelocity[] = inventoryRows
      .map((row: any) => {
        const history = demandHistoryMap.get(row.lasyncro_variant_id) ?? {
          units30d: 0,
          unitsPrev30d: 0,
          units90d: 0,
          units180d: 0,
          events30d: 0,
          events90d: 0,
          events180d: 0,
        };

        const units30d = history.units30d;
        const unitsPrev30d = history.unitsPrev30d;
        const unitsAllTime = allTimeSalesMap.get(row.lasyncro_variant_id) ?? 0;
        const availableQty = Number(row.available_quantity ?? 0);

        const velocityWindowDays =
          history.events30d >= MIN_FULFILLMENT_EVENTS
            ? VELOCITY_WINDOW_DAYS
            : history.events90d >= MIN_FULFILLMENT_EVENTS
              ? MEDIUM_VELOCITY_WINDOW_DAYS
              : MAX_VELOCITY_WINDOW_DAYS;

        const demandConfidence: 'high' | 'medium' | 'low' | 'none' =
          history.events30d >= MIN_FULFILLMENT_EVENTS
            ? 'high'
            : history.events90d >= MIN_FULFILLMENT_EVENTS ||
                history.events180d >= MIN_FULFILLMENT_EVENTS
              ? 'medium'
              : history.events180d > 0
                ? 'low'
                : 'none';

        const velocityUnits =
          velocityWindowDays === VELOCITY_WINDOW_DAYS
            ? history.units30d
            : velocityWindowDays === MEDIUM_VELOCITY_WINDOW_DAYS
              ? history.units90d
              : history.units180d;

        // Preserve sparse long-tail velocity; rounding here previously turned
        // demand below 0.005 units/day into false zero demand.
        const velocityPerDay =
          velocityUnits > 0 ? velocityUnits / velocityWindowDays : 0;

        /**
         * STOCK-PROTECT-01: effective safety/review-cycle days come from the
         * approved policy when one exists, otherwise the same legacy 5/7
         * default resolveEffectivePolicy(null) has always returned.
         *
         * Supplier lead time: an approved policy's explicit
         * planning_supplier_id is authoritative (contract item 11) and is
         * NEVER overridden by a newer PO from a different supplier. If that
         * anchored supplier is missing/inactive, leadTimeDays resolves to
         * null here — never silently substituted — which deriveUrgency
         * below already turns into 'planning_data_required'. Only when
         * there is no approved policy, or the approved policy has no
         * explicit supplier anchor, does legacy most-recent-PO resolution
         * (supplierLeadTimeMap) apply.
         */
        const policyRow = policyMap.get(row.lasyncro_variant_id);
        const effectivePolicy = resolveEffectiveStockProtectionPolicy(
          policyRow
            ? {
                version: policyRow.version,
                safety_days: policyRow.safety_days,
                review_cycle_days: policyRow.review_cycle_days,
                planning_supplier_id: policyRow.planning_supplier_id,
              }
            : null
        );
        const effectiveSafetyDays = effectivePolicy.safety_days;
        const effectiveReviewCycleDays = effectivePolicy.review_cycle_days;

        let leadTimeDays: number | null;
        if (effectivePolicy.source === 'merchant_approved' && effectivePolicy.planning_supplier_id !== null) {
          const anchoredSupplier = anchoredSupplierMap.get(effectivePolicy.planning_supplier_id);
          leadTimeDays =
            anchoredSupplier && anchoredSupplier.active && anchoredSupplier.lead_time_days !== null
              ? Number(anchoredSupplier.lead_time_days)
              : null;
        } else {
          leadTimeDays = supplierLeadTimeMap.get(row.lasyncro_variant_id) ?? null;
        }

        // STOCK-PROTECT-02: the supplier IDENTITY behind leadTimeDays above,
        // exposed unconditionally (unlike leadTimeDays, which is null when
        // the anchored supplier is invalid/inactive) — a downstream reader
        // still needs to know WHICH supplier to evaluate even when that
        // supplier's configured lead time itself is unusable.
        const planningSupplierId: number | null =
          effectivePolicy.source === 'merchant_approved' && effectivePolicy.planning_supplier_id !== null
            ? effectivePolicy.planning_supplier_id
            : legacySupplierIdMap.get(row.lasyncro_variant_id) ?? null;

        // Velocity trend: compare current vs prior 30d
        const velocityTrend: 'up' | 'down' | 'stable' = (() => {
          if (unitsPrev30d === 0 && units30d > 0) return 'up';
          if (unitsPrev30d === 0) return 'stable';
          const changePct = (units30d - unitsPrev30d) / unitsPrev30d;
          if (changePct > 0.1) return 'up';
          if (changePct < -0.1) return 'down';
          return 'stable';
        })();

        // Suggested reorder: velocity x (lead time + safety + purchasing
        // cycle) + open demand - available - reliable inbound. No hidden
        // multiplier; every term is named and derived.
        const openDemandQty =
          openDemandMap.get(row.lasyncro_variant_id) ?? 0;

        const targetCoverageDays =
          leadTimeDays !== null
            ? leadTimeDays +
              effectiveSafetyDays +
              effectiveReviewCycleDays
            : null;

        /**
         * SRC-18a: only inbound landing INSIDE this variant's coverage window
         * offsets the need to order now. A PO arriving on the last day of the
         * window still replaces the stock that runs out then; one arriving
         * after it does not, and subtracting it told the merchant to wait for
         * goods that arrive after they stock out.
         *
         * Null days_out (no recorded ETA) counts as in-window — see the map
         * construction above.
         *
         * targetCoverageDays null means no supplier lead time, in which case
         * suggestedReorderQty is null regardless and this value is unused; the
         * full sum is kept so the number stays meaningful if it is ever read.
         */
        const inboundLines =
          reliableInboundMap.get(row.lasyncro_variant_id) ?? [];
        const reliableInboundQty = inboundLines.reduce(
          (sum, line) =>
            targetCoverageDays === null ||
            line.daysOut === null ||
            line.daysOut <= targetCoverageDays
              ? sum + line.qty
              : sum,
          0
        );

        const suggestedReorderQty =
          velocityPerDay > 0 && targetCoverageDays !== null
            ? Math.max(
                0,
                Math.ceil(
                  velocityPerDay * targetCoverageDays +
                  openDemandQty -
                  availableQty -
                  reliableInboundQty
                )
              )
            : null;

        const daysOfStock =
          velocityPerDay > 0
            ? Math.round(availableQty / velocityPerDay)
            : null;

        const urgency = deriveUrgency(
          daysOfStock,
          velocityPerDay,
          availableQty,
          leadTimeDays,
          effectiveSafetyDays
        );
        const reorderSignal = urgency === 'critical' || urgency === 'warning';

        const stockoutDate =
          daysOfStock != null && velocityPerDay > 0
            ? new Date(Date.now() + daysOfStock * 24 * 60 * 60 * 1000).toISOString()
            : null;

        return {
          lasyncro_variant_id: row.lasyncro_variant_id,
          title: row.title ?? null,
          sku: row.sku ?? null,
          product_title: row.product_title ?? null,
          unit_cost: row.unit_cost != null ? Number(row.unit_cost) : null,
          available_quantity: availableQty,
          units_sold_30d: units30d,
          units_sold_prev_30d: unitsPrev30d,
          units_sold_all_time: unitsAllTime,
          velocity_per_day: velocityPerDay,
          velocity_window_days: velocityWindowDays as 30 | 90 | 180,
          demand_confidence: demandConfidence,
          velocity_trend: velocityTrend,
          days_of_stock_remaining: daysOfStock,
          reorder_signal: reorderSignal,
          reorder_urgency: urgency,
          estimated_stockout_date: stockoutDate,
          suggested_reorder_qty: suggestedReorderQty,
          supplier_lead_time_days: supplierLeadTimeMap.get(row.lasyncro_variant_id) ?? null,
          planning_supplier_id: planningSupplierId,
          target_coverage_days: targetCoverageDays,
        };
      })

      .filter((v: DemandVelocity) => {
        if (eligibilityMode !== 'stock_protection') {
          return v.units_sold_all_time > 0 || v.available_quantity > 0;
        }

        /**
         * STOCK-PROTECT-03 eligibility contract — a variant is eligible when
         * ANY relevance signal holds. Ordered/confirmed/in_production PO
         * status is deliberately NOT one of them here (see
         * STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES) — a committed,
         * pre-arrival PO alone must never wake an otherwise dormant SKU.
         */
        if (v.available_quantity > 0) return true; // A
        if (v.units_sold_all_time > 0) return true; // B
        if ((openDemandMap.get(v.lasyncro_variant_id) ?? 0) > 0) return true; // C
        if (policyMap.has(v.lasyncro_variant_id)) return true; // D
        if (replenishmentEvidence!.pendingReorderRequestVariantIds.has(v.lasyncro_variant_id)) return true; // E
        const poStatuses = replenishmentEvidence!.poStatusesByVariant.get(v.lasyncro_variant_id);
        if (poStatuses && STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES.some((s) => poStatuses.has(s))) return true; // F
        return false;
      })

      .sort((a: DemandVelocity, b: DemandVelocity) => {
        const urgencyOrder = {
          critical: 0,
          warning: 1,
          planning_data_required: 2,
          healthy: 3,
          no_velocity: 4,
        };
        return (urgencyOrder[a.reorder_urgency] ?? 5) - (urgencyOrder[b.reorder_urgency] ?? 5);
      });
    return variants;
}

/**
 * STOCKOUT ALERT EMISSION (SRC-18c)
 * ---------------------------------
 * WRITE-ONLY. Computes nothing — callers supply already-planned variants
 * from computeVariantPlanning so every writer emits the SAME message from
 * the SAME numbers, net of reliable inbound.
 *
 * Extracted because resolve_inventory_block.handler.ts previously wrote its
 * own competing row on the identical alert_key with a raw
 * order_qty - available figure that ignored committed inbound entirely —
 * telling merchants to reorder units already on a purchase order.
 *
 * Takes a caller-supplied transaction: the caller owns the tenant scope
 * (SET LOCAL app.current_tenant) and the transaction lifetime.
 *
 * Reconciles as well as emits: any active source:'demand' alert not in the
 * supplied critical set is resolved. Safe because this is now the only
 * writer to that source.
 */
export async function emitStockoutAlerts(
  trx: Knex.Transaction,
  shopId: number,
  variants: DemandVelocity[],
  reconcile: boolean = true
): Promise<void> {
  // Fire demand alerts for critical variants (stockout risk)
  // Non-blocking — alert failure must not fail the demand computation
  const criticalVariants = variants.filter(v => v.reorder_urgency === 'critical');
  for (const v of criticalVariants) {
    try {
      await trx('alerts')
        .insert({
          shop_id: shopId,
          alert_key: `demand:stockout_risk:${v.lasyncro_variant_id}`,
          source: 'demand',
          alert_type: 'stockout_risk',
          severity: 'critical',
          title: v.sku && v.title && v.sku !== v.title
            ? `${v.title} (${v.sku}) — stockout risk`
            : `${v.sku ?? v.title ?? 'Variant'} — stockout risk`,
          message: (() => {
            const qty = v.suggested_reorder_qty;
            const qtyLabel = qty != null ? `${qty} unit${qty === 1 ? '' : 's'}` : null;
            if (v.available_quantity <= 0) {
              return `Out of stock — reorder ${qtyLabel ?? 'immediately'}.`;
            }
            if (v.days_of_stock_remaining != null) {
              return `${v.days_of_stock_remaining} days of stock at current velocity. Suggested reorder: ${qtyLabel ?? 'unknown'}.`;
            }
            return 'Stock depleted — reorder immediately.';
          })(),
          entity_id: v.lasyncro_variant_id,
          entity_type: 'variant',
          revenue_impact: v.unit_cost && v.suggested_reorder_qty
            ? v.unit_cost * v.suggested_reorder_qty
            : null,
          is_active: true,
          category: 'stock_reorder',
          audience: 'all',
        })
        .onConflict(['shop_id', 'alert_key'])
        .merge({
          is_active: true,
          title:     trx.raw('EXCLUDED.title'),
          message:   trx.raw('EXCLUDED.message'),
          category:  'stock_reorder',
          audience:  'all',
          updated_at: trx.fn.now(),
        });
    } catch {
      // non-fatal
    }
  }

  // Resolve alerts for variants that are no longer critical or are no longer
  // demand-eligible (for example inactive or non-physical catalog records).
  // SRC-18c/D2: the sweep resolves EVERY active source:'demand' alert absent
  // from `variants`, so it is only sound for a caller holding the full
  // catalogue. A partial caller (resolve_inventory_block, which knows only
  // one order's shorted variants) passes reconcile=false — otherwise it would
  // deactivate every other variant's stockout alert in the shop.
  if (!reconcile) return;

  const criticalAlertKeys = new Set(
    variants
      .filter(v => v.reorder_urgency === 'critical')
      .map(v => `demand:stockout_risk:${v.lasyncro_variant_id}`)
  );

  // Resolve ALL active demand alerts for this shop that aren't in the current critical set
  await trx('alerts')
    .where({ shop_id: shopId, source: 'demand', is_active: true })
    .whereNotIn('alert_key', Array.from(criticalAlertKeys))
    .update({ is_active: false, resolved_at: trx.fn.now(), updated_at: trx.fn.now() });
}

export async function computeDemandIntelligence(
  shopId: number
): Promise<DemandIntelligenceResult> {
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const variants = await computeVariantPlanning(trx, shopId);

    /**
     * SUMMARY
     */
    const variantsWithVelocity = variants.filter(v => v.velocity_per_day > 0);
    const avgDaysOfStock =
      variantsWithVelocity.length > 0
        ? Math.round(
            variantsWithVelocity
              .filter(v => v.days_of_stock_remaining !== null)
              .reduce((s, v) => s + (v.days_of_stock_remaining ?? 0), 0) /
            variantsWithVelocity.length
          )
        : null;

    const totalInventoryValue = variants.reduce((s, v) => {
      if (v.unit_cost && v.available_quantity > 0) {
        return s + v.unit_cost * v.available_quantity;
      }
      return s;
    }, 0);

    const summary: DemandSummary = {
      total_variants_tracked: variants.length,
      critical_reorder_count: variants.filter(v => v.reorder_urgency === 'critical').length,
      warning_reorder_count: variants.filter(v => v.reorder_urgency === 'warning').length,
      stockout_count: variants.filter(v => v.available_quantity <= 0).length,
      avg_days_of_stock: avgDaysOfStock,
      total_inventory_value: Math.round(totalInventoryValue * 100) / 100,
    };

    return { summary, variants, computed_at: new Date().toISOString() };
  });
}
