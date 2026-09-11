// apps/backend/src/services/inventory/stockProtectionBufferDiagnosis.ts
//
// STOCK-PROTECT-02 — pure Buffer Diagnosis decision rule.
// ============================================================================
// computeBufferDiagnosis(input) is a PURE function: no DB, no network, no
// transaction, no clock dependency beyond stamping `generated_at`. It never
// reads or writes stock_protection_policies / stock_protection_policy_
// transitions — a recommendation is evidence only, recalculable at any time
// without ever touching approved-policy authority.
//
// `demand.demandConfidence` reuses the EXISTING Demand contract verbatim
// (high/medium/low/none — demandIntelligence.service.ts). This function's
// OWN overall `confidence` output is a DIFFERENT scale (insufficient/low/
// medium/high) that also folds in supplier evidence sufficiency — the two
// are deliberately not the same enum reused twice.
//
// NO FAKE PRECISION: none/low demand confidence short-circuits to the
// baseline with zero adjustments and confidence='insufficient' — never a
// computed number dressed up as personalized.

export interface BufferDiagnosisDemandEvidence {
  /** Reused verbatim from demandIntelligence.service.ts's existing contract. */
  demandConfidence: 'high' | 'medium' | 'low' | 'none';
  velocityWindowDays: 30 | 90 | 180 | null;
  /** Coefficient of variation of weekly fulfilled demand. Null when unknown. */
  coefficientOfVariation: number | null;
  /** Fraction (0..1) of recent weeks with zero fulfilled demand. */
  zeroDemandWeekFraction: number | null;
  /** Whether at least one week shows a demand burst relative to baseline. */
  hasBurstActivity: boolean;
  /** Fractional change (0.30 = +30%) of recent vs prior demand. */
  trendPercentChange: number | null;
}

export interface BufferDiagnosisSupplierEvidence {
  hasEvidence: boolean;
  onTimeRatePercent: number | null;
  fillRatePercent: number | null;
  /** Sample size derived LIVE from settled PO rows — never a stored supplier-level completed-order counter. */
  settledPoCount: number;
  /** Whether canonical Demand planning resolved ANY planning supplier for this variant. */
  hasPlanningSupplier: boolean;
  /** Whether that planning supplier's canonical configured lead_time_days is non-null. Irrelevant when hasPlanningSupplier is false. */
  hasConfiguredLeadTime: boolean;
}

export interface BufferDiagnosisInput {
  demand: BufferDiagnosisDemandEvidence;
  supplier: BufferDiagnosisSupplierEvidence;
}

export type BufferDiagnosisConfidence = 'insufficient' | 'low' | 'medium' | 'high';

export interface BufferDiagnosisAdjustment {
  category: 'demand' | 'supplier';
  reason_code: string;
  delta_days: number;
  explanation: string;
}

export interface BufferDiagnosisResult {
  recommended_safety_days: number;
  baseline_safety_days: number;
  confidence: BufferDiagnosisConfidence;
  adjustments: BufferDiagnosisAdjustment[];
  evidence: {
    demand: BufferDiagnosisDemandEvidence;
    supplier: BufferDiagnosisSupplierEvidence;
  };
  limitations: string[];
  generated_at: string;
}

const BASELINE_SAFETY_DAYS = 5;
const MAX_SAFETY_DAYS = 10;
const DEMAND_ADJUSTMENT_CAP = 3;
const SUPPLIER_ADJUSTMENT_CAP = 2;
const MEDIUM_SUPPLIER_PO_THRESHOLD = 3;
const HIGH_SUPPLIER_PO_THRESHOLD = 15;

/**
 * Stable reason codes. Every non-zero adjustment carries exactly one of
 * these, plus a human explanation — durable enough for a merchant-facing UI
 * or an audit trail to key off of.
 */
const REASON_CODES = {
  DEMAND_VARIABILITY: 'demand_variability',
  DEMAND_LUMPINESS: 'demand_lumpiness',
  DEMAND_UPWARD_TREND: 'demand_upward_trend',
  SUPPLIER_LATENESS: 'supplier_lateness',
  SUPPLIER_FILL_RISK: 'supplier_fill_risk',
} as const;

const LIMITATIONS = {
  INSUFFICIENT_DEMAND_HISTORY: 'insufficient_demand_history',
  INSUFFICIENT_SUPPLIER_HISTORY: 'insufficient_supplier_history',
  SUPPLIER_METRICS_UNAVAILABLE: 'supplier_metrics_unavailable',
  NO_PLANNING_SUPPLIER: 'no_planning_supplier',
  NO_CONFIGURED_LEAD_TIME: 'no_configured_lead_time',
} as const;

function computeDemandAdjustments(
  demand: BufferDiagnosisDemandEvidence
): BufferDiagnosisAdjustment[] {
  const candidates: BufferDiagnosisAdjustment[] = [];

  const cv = demand.coefficientOfVariation;
  if (cv !== null) {
    if (cv > 1.0) {
      candidates.push({
        category: 'demand',
        reason_code: REASON_CODES.DEMAND_VARIABILITY,
        delta_days: 2,
        explanation: `Weekly demand coefficient of variation (${cv.toFixed(2)}) is above 1.00 — highly variable demand.`,
      });
    } else if (cv >= 0.5) {
      candidates.push({
        category: 'demand',
        reason_code: REASON_CODES.DEMAND_VARIABILITY,
        delta_days: 1,
        explanation: `Weekly demand coefficient of variation (${cv.toFixed(2)}) is between 0.50 and 1.00 — moderately variable demand.`,
      });
    }
  }

  const zeroWeekFraction = demand.zeroDemandWeekFraction;
  if (zeroWeekFraction !== null && zeroWeekFraction > 0.5 && demand.hasBurstActivity) {
    candidates.push({
      category: 'demand',
      reason_code: REASON_CODES.DEMAND_LUMPINESS,
      delta_days: 1,
      explanation: `More than half of recent weeks had zero fulfilled demand, with burst activity in the remaining weeks — lumpy demand pattern.`,
    });
  }

  // The upward-trend signal requires the underlying demand_confidence to be
  // 'high' — at 'medium' confidence there is not yet enough evidence to
  // stake an extra safety day on a directional claim (contract: "trend
  // bonus NOT allowed" below high confidence).
  const trend = demand.trendPercentChange;
  if (demand.demandConfidence === 'high' && trend !== null && trend >= 0.25) {
    candidates.push({
      category: 'demand',
      reason_code: REASON_CODES.DEMAND_UPWARD_TREND,
      delta_days: 1,
      explanation: `Recent demand is up ${(trend * 100).toFixed(0)}% versus the prior period.`,
    });
  }

  return capCategoryAdjustments(candidates, DEMAND_ADJUSTMENT_CAP);
}

function computeSupplierAdjustments(
  supplier: BufferDiagnosisSupplierEvidence
): BufferDiagnosisAdjustment[] {
  const candidates: BufferDiagnosisAdjustment[] = [];

  if (!supplier.hasEvidence) {
    // Missing evidence adds 0 days — never guessed. Confidence degrades
    // instead (see computeConfidence).
    return candidates;
  }

  const onTime = supplier.onTimeRatePercent;
  if (onTime !== null) {
    if (onTime < 85) {
      candidates.push({
        category: 'supplier',
        reason_code: REASON_CODES.SUPPLIER_LATENESS,
        delta_days: 2,
        explanation: `Settled on-time delivery rate (${onTime.toFixed(1)}%) is below 85%.`,
      });
    } else if (onTime < 95) {
      candidates.push({
        category: 'supplier',
        reason_code: REASON_CODES.SUPPLIER_LATENESS,
        delta_days: 1,
        explanation: `Settled on-time delivery rate (${onTime.toFixed(1)}%) is between 85% and 95%.`,
      });
    }
  }

  const fill = supplier.fillRatePercent;
  if (fill !== null) {
    if (fill < 95) {
      candidates.push({
        category: 'supplier',
        reason_code: REASON_CODES.SUPPLIER_FILL_RISK,
        delta_days: 2,
        explanation: `Settled fill rate (${fill.toFixed(1)}%) is below 95%.`,
      });
    } else if (fill < 98) {
      candidates.push({
        category: 'supplier',
        reason_code: REASON_CODES.SUPPLIER_FILL_RISK,
        delta_days: 1,
        explanation: `Settled fill rate (${fill.toFixed(1)}%) is between 95% and 98%.`,
      });
    }
  }

  return capCategoryAdjustments(candidates, SUPPLIER_ADJUSTMENT_CAP);
}

/**
 * Greedily keeps candidates (in the order they were evaluated) while the
 * running total stays within `cap`; a candidate that would push the total
 * over the cap is dropped entirely rather than partially applied, so every
 * surviving adjustment remains a genuine, fully-explained signal — never a
 * fabricated partial value.
 */
function capCategoryAdjustments(
  candidates: BufferDiagnosisAdjustment[],
  cap: number
): BufferDiagnosisAdjustment[] {
  const kept: BufferDiagnosisAdjustment[] = [];
  let running = 0;
  for (const candidate of candidates) {
    if (running + candidate.delta_days <= cap) {
      kept.push(candidate);
      running += candidate.delta_days;
    }
  }
  return kept;
}

function computeConfidence(input: BufferDiagnosisInput): BufferDiagnosisConfidence {
  const { demand, supplier } = input;

  if (demand.demandConfidence === 'none' || demand.demandConfidence === 'low') {
    return 'insufficient';
  }

  if (demand.demandConfidence === 'medium') {
    return 'low';
  }

  // demand.demandConfidence === 'high' from here on.
  if (!supplier.hasEvidence || supplier.settledPoCount < MEDIUM_SUPPLIER_PO_THRESHOLD) {
    return 'low';
  }

  const requiredSupplierEvidencePopulated =
    supplier.onTimeRatePercent !== null && supplier.fillRatePercent !== null;

  if (supplier.settledPoCount >= HIGH_SUPPLIER_PO_THRESHOLD && requiredSupplierEvidencePopulated) {
    return 'high';
  }

  return 'medium';
}

function computeLimitations(input: BufferDiagnosisInput): string[] {
  const limitations: string[] = [];
  const { demand, supplier } = input;

  if (demand.demandConfidence === 'none' || demand.demandConfidence === 'low') {
    limitations.push(LIMITATIONS.INSUFFICIENT_DEMAND_HISTORY);
  }

  // Avoid contradictory limitations: when there is no planning supplier at
  // all, that is the ONE thing worth saying about supplier evidence — it
  // subsumes "no configured lead time" and "no metrics/history", both of
  // which are trivially true but redundant once the more fundamental gap is
  // named.
  if (!supplier.hasPlanningSupplier) {
    limitations.push(LIMITATIONS.NO_PLANNING_SUPPLIER);
  } else {
    if (!supplier.hasConfiguredLeadTime) {
      limitations.push(LIMITATIONS.NO_CONFIGURED_LEAD_TIME);
    }
    if (!supplier.hasEvidence) {
      limitations.push(LIMITATIONS.SUPPLIER_METRICS_UNAVAILABLE);
    } else if (supplier.settledPoCount < MEDIUM_SUPPLIER_PO_THRESHOLD) {
      limitations.push(LIMITATIONS.INSUFFICIENT_SUPPLIER_HISTORY);
    }
  }

  return limitations;
}

export function computeBufferDiagnosis(input: BufferDiagnosisInput): BufferDiagnosisResult {
  const { demand, supplier } = input;
  const generated_at = new Date().toISOString();

  // NO FAKE PRECISION: none/low demand confidence short-circuits entirely —
  // no demand or supplier adjustment is ever computed on top of
  // insufficient demand evidence.
  if (demand.demandConfidence === 'none' || demand.demandConfidence === 'low') {
    return {
      recommended_safety_days: BASELINE_SAFETY_DAYS,
      baseline_safety_days: BASELINE_SAFETY_DAYS,
      confidence: 'insufficient',
      adjustments: [],
      evidence: { demand, supplier },
      limitations: computeLimitations(input),
      generated_at,
    };
  }

  const demandAdjustments = computeDemandAdjustments(demand);
  const supplierAdjustments = computeSupplierAdjustments(supplier);
  const adjustments = [...demandAdjustments, ...supplierAdjustments];

  const totalAdjustment = adjustments.reduce((sum, a) => sum + a.delta_days, 0);
  const recommended_safety_days = Math.min(
    MAX_SAFETY_DAYS,
    Math.max(BASELINE_SAFETY_DAYS, BASELINE_SAFETY_DAYS + totalAdjustment)
  );

  return {
    recommended_safety_days,
    baseline_safety_days: BASELINE_SAFETY_DAYS,
    confidence: computeConfidence(input),
    adjustments,
    evidence: { demand, supplier },
    limitations: computeLimitations(input),
    generated_at,
  };
}
