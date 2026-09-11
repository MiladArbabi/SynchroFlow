// apps/backend/src/services/inventory/stockProtectionBufferEvidence.ts
//
// STOCK-PROTECT-02 — Buffer Diagnosis evidence gathering. READ ONLY.
// ============================================================================
// Gathers the pre-computed evidence consumed by the pure decision rule in
// stockProtectionBufferDiagnosis.ts. Never mutates anything; never writes
// stock_protection_policies / stock_protection_policy_transitions.
//
// CRITICAL ARCHITECTURE RULE
//   demand_confidence, the velocity window, and canonical planning-supplier/
//   lead-time identity are NOT recomputed here — they are read straight from
//   demandIntelligence.service.ts's computeVariantPlanning, the single
//   canonical Demand engine. This file adds ONLY the metrics that engine
//   does not already produce: weekly demand-variability statistics (from the
//   same fulfillment source tables) and settled supplier reliability (from
//   purchase order rows, scoped to fully-completed orders only).
//
// SETTLED SUPPLIER EVIDENCE (STOCK-PROTECT-02A audit findings)
//   Only fully-completed purchase orders count as settled evidence — an
//   order still awaiting the remainder of its shipment measures "was the
//   first partial shipment on time," not "did the order complete on time,"
//   and its fill ratio is a moving snapshot, not a final observation. No
//   stored supplier-level completed-order counter is used as the
//   sample-size denominator — it increments on a different condition than
//   the one used here and cannot be trusted as a proxy for it; the sample
//   count is always derived live from the purchase order rows actually
//   queried. Schedule variance (actual minus expected delivery date) is a
//   lateness/earliness signal, never a stand-in for the merchant-configured
//   planning lead time, and the WMS-receive-exception-derived quality
//   signal is out of scope for this general V1 evidence set.

import type { Knex } from 'knex';
import { computeVariantPlanning, type DemandVelocity } from '../demand/demandIntelligence.service.js';
import type { BufferDiagnosisDemandEvidence, BufferDiagnosisSupplierEvidence } from './stockProtectionBufferDiagnosis.js';

/** The one purchase-order status that counts as a fully-completed, settled order. */
const SETTLED_PO_STATUS = 'received';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const VARIABILITY_WINDOW_WEEKS = 12;
const TREND_HALF_WEEKS = 6;
/** A week's total more than this multiple of the mean counts as a burst. */
const BURST_MULTIPLE = 3;

/**
 * What deriveSupplierEvidence() itself can determine about ONE known
 * supplier's settled orders. Deliberately does NOT know about
 * hasPlanningSupplier/hasConfiguredLeadTime — those are variant-level
 * facts resolved by canonical Demand planning, added by the caller
 * (gatherBufferDiagnosisEvidence) rather than re-derived here.
 */
export interface SupplierEvidenceResult {
  hasEvidence: boolean;
  onTimeRatePercent: number | null;
  fillRatePercent: number | null;
  settledPoCount: number;
  /** actual_delivery_date - expected_delivery_date, mean days, across settled orders with both dates. Null when none qualify. */
  scheduleVarianceDays: number | null;
}

/**
 * Derives settled supplier-reliability evidence for ONE supplier, live from
 * purchase_orders/purchase_order_line_items — never from the supplier's own
 * stored aggregate rating columns, which mix in non-final orders and cannot
 * be trusted as a sample-size authority.
 */
export async function deriveSupplierEvidence(
  trx: Knex.Transaction,
  shopId: number,
  supplierId: number
): Promise<SupplierEvidenceResult> {
  const settledPos: Array<{
    id: string;
    expected_delivery_date: string | null;
    actual_delivery_date: string | null;
  }> = await trx('purchase_orders')
    .where({ shop_id: shopId, supplier_id: supplierId, status: SETTLED_PO_STATUS })
    .select('id', 'expected_delivery_date', 'actual_delivery_date');

  const settledPoCount = settledPos.length;

  if (settledPoCount === 0) {
    return {
      hasEvidence: false,
      onTimeRatePercent: null,
      fillRatePercent: null,
      settledPoCount: 0,
      scheduleVarianceDays: null,
    };
  }

  const onTimeCount = settledPos.filter(
    (po) =>
      po.actual_delivery_date !== null &&
      po.expected_delivery_date !== null &&
      new Date(po.actual_delivery_date) <= new Date(po.expected_delivery_date)
  ).length;
  const onTimeRatePercent = (onTimeCount / settledPoCount) * 100;

  const posWithBothDates = settledPos.filter(
    (po) => po.actual_delivery_date !== null && po.expected_delivery_date !== null
  );
  const scheduleVarianceDays =
    posWithBothDates.length > 0
      ? posWithBothDates.reduce((sum, po) => {
          const diffDays =
            (new Date(po.actual_delivery_date as string).getTime() -
              new Date(po.expected_delivery_date as string).getTime()) /
            (1000 * 60 * 60 * 24);
          return sum + diffDays;
        }, 0) / posWithBothDates.length
      : null;

  const settledPoIds = settledPos.map((po) => po.id);
  const fillTotals = await trx('purchase_order_line_items')
    .where({ shop_id: shopId })
    .whereIn('po_id', settledPoIds)
    .sum({ ordered: 'quantity_ordered', received: 'quantity_received' })
    .first();

  const totalOrdered = Number(fillTotals?.ordered ?? 0);
  const totalReceived = Number(fillTotals?.received ?? 0);
  const fillRatePercent = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : null;

  return {
    hasEvidence: true,
    onTimeRatePercent,
    fillRatePercent,
    settledPoCount,
    scheduleVarianceDays,
  };
}

/**
 * Derives weekly demand-variability evidence for one variant from the SAME
 * canonical fulfillment source tables demandIntelligence.service.ts reads
 * (order_revenue_units + order_fulfillment_status + orders) — a genuinely
 * new statistic (Demand does not compute weekly variance anywhere), not a
 * duplicate of demand_confidence or the velocity-window selection, both of
 * which remain owned entirely by computeVariantPlanning.
 */
async function deriveDemandVariability(
  trx: Knex.Transaction,
  shopId: number,
  variantId: string
): Promise<{
  coefficientOfVariation: number | null;
  zeroDemandWeekFraction: number | null;
  hasBurstActivity: boolean;
  trendPercentChange: number | null;
}> {
  const windowStart = new Date(Date.now() - VARIABILITY_WINDOW_WEEKS * WEEK_MS);

  const rows: Array<{ fulfilled_at: string; quantity: string }> = await trx('order_revenue_units as oru')
    .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
    .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'oru.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('oru.lasyncro_variant_id', variantId)
    .whereNotNull('ofs.fulfilled_at')
    .andWhere('ofs.fulfilled_at', '>=', windowStart)
    .select('ofs.fulfilled_at', 'oru.fulfilled_quantity as quantity');

  const weeklyTotals = new Array(VARIABILITY_WINDOW_WEEKS).fill(0) as number[];
  const now = Date.now();
  for (const row of rows) {
    const ageMs = now - new Date(row.fulfilled_at).getTime();
    const weekIndexFromNow = Math.floor(ageMs / WEEK_MS);
    // weekIndexFromNow=0 is the most recent week; convert to chronological
    // order (index 0 = oldest) for the trend comparison below.
    const chronologicalIndex = VARIABILITY_WINDOW_WEEKS - 1 - weekIndexFromNow;
    if (chronologicalIndex >= 0 && chronologicalIndex < VARIABILITY_WINDOW_WEEKS) {
      weeklyTotals[chronologicalIndex] += Number(row.quantity);
    }
  }

  const mean = weeklyTotals.reduce((sum, v) => sum + v, 0) / VARIABILITY_WINDOW_WEEKS;
  const zeroDemandWeekFraction =
    weeklyTotals.filter((v) => v === 0).length / VARIABILITY_WINDOW_WEEKS;

  let coefficientOfVariation: number | null = null;
  let hasBurstActivity = false;
  if (mean > 0) {
    const variance =
      weeklyTotals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / VARIABILITY_WINDOW_WEEKS;
    const stdDev = Math.sqrt(variance);
    coefficientOfVariation = stdDev / mean;
    hasBurstActivity = weeklyTotals.some((v) => v > mean * BURST_MULTIPLE);
  }

  const priorHalf = weeklyTotals.slice(0, VARIABILITY_WINDOW_WEEKS - TREND_HALF_WEEKS);
  const recentHalf = weeklyTotals.slice(VARIABILITY_WINDOW_WEEKS - TREND_HALF_WEEKS);
  const priorHalfSum = priorHalf.reduce((sum, v) => sum + v, 0);
  const recentHalfSum = recentHalf.reduce((sum, v) => sum + v, 0);
  const trendPercentChange =
    priorHalfSum > 0 ? (recentHalfSum - priorHalfSum) / priorHalfSum : recentHalfSum > 0 ? 1 : null;

  return { coefficientOfVariation, zeroDemandWeekFraction, hasBurstActivity, trendPercentChange };
}

export interface BufferDiagnosisEvidenceBundle {
  demand: BufferDiagnosisDemandEvidence;
  supplier: BufferDiagnosisSupplierEvidence & SupplierEvidenceResult;
}

/** Raised when the requested variant does not belong to the caller's tenant. */
export class BufferDiagnosisVariantNotFoundError extends Error {
  readonly shopId: number;
  readonly variantId: string;

  constructor(shopId: number, variantId: string) {
    super(`[stock-protection-buffer-evidence] variant ${variantId} not found for shop ${shopId}.`);
    this.name = 'BufferDiagnosisVariantNotFoundError';
    this.shopId = shopId;
    this.variantId = variantId;
  }
}

const NO_SETTLED_EVIDENCE: SupplierEvidenceResult = {
  hasEvidence: false,
  onTimeRatePercent: null,
  fillRatePercent: null,
  settledPoCount: 0,
  scheduleVarianceDays: null,
};

/** No planning supplier was resolved at all — the most fundamental supplier gap. */
const NO_PLANNING_SUPPLIER_EVIDENCE: BufferDiagnosisSupplierEvidence & SupplierEvidenceResult = {
  ...NO_SETTLED_EVIDENCE,
  hasPlanningSupplier: false,
  hasConfiguredLeadTime: false,
};

/**
 * Gathers the complete evidence bundle for one shop+variant, ready to pass
 * straight into computeBufferDiagnosis(). Read-only throughout.
 */
export async function gatherBufferDiagnosisEvidence(
  trx: Knex.Transaction,
  shopId: number,
  variantId: string
): Promise<BufferDiagnosisEvidenceBundle> {
  // Tenant safety: never trust a client-supplied variant id alone — RLS
  // alone would silently return "no evidence" for a foreign-tenant variant,
  // which is indistinguishable from a genuinely fresh in-tenant variant.
  const variant = await trx('variants').where({ lasyncro_variant_id: variantId, shop_id: shopId }).first('lasyncro_variant_id');
  if (!variant) {
    throw new BufferDiagnosisVariantNotFoundError(shopId, variantId);
  }

  const planningRows: DemandVelocity[] = await computeVariantPlanning(trx, shopId, [variantId]);
  const planning = planningRows.find((r) => r.lasyncro_variant_id === variantId) ?? null;

  if (!planning) {
    // No sales/stock history at all — computeVariantPlanning's own
    // catalogue query never returns a row for a variant with no fulfilled
    // history and no inventory. Treated identically to demand_confidence
    // 'none': the pure diagnosis short-circuits on this regardless of what
    // supplier evidence would otherwise say.
    return {
      demand: {
        demandConfidence: 'none',
        velocityWindowDays: null,
        coefficientOfVariation: null,
        zeroDemandWeekFraction: null,
        hasBurstActivity: false,
        trendPercentChange: null,
      },
      supplier: NO_PLANNING_SUPPLIER_EVIDENCE,
    };
  }

  const variability = await deriveDemandVariability(trx, shopId, variantId);

  const demand: BufferDiagnosisDemandEvidence = {
    demandConfidence: planning.demand_confidence,
    velocityWindowDays: planning.velocity_window_days,
    ...variability,
  };

  // Reuses computeVariantPlanning's already-resolved planning_supplier_id /
  // supplier_lead_time_days verbatim — never re-derives supplier selection
  // or re-queries the supplier's configured lead time here.
  const supplier: BufferDiagnosisSupplierEvidence & SupplierEvidenceResult =
    planning.planning_supplier_id !== null
      ? {
          ...(await deriveSupplierEvidence(trx, shopId, planning.planning_supplier_id)),
          hasPlanningSupplier: true,
          hasConfiguredLeadTime: planning.supplier_lead_time_days !== null,
        }
      : NO_PLANNING_SUPPLIER_EVIDENCE;

  return { demand, supplier };
}
