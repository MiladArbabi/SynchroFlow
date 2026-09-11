// tests/unit/inventory/stock-protection-buffer-diagnosis.test.ts
//
// STOCK-PROTECT-02 — UNIT contract for the pure Buffer Diagnosis decision
// rule. PERMANENT regression contract, authored RED.
// ============================================================================
// INDEPENDENTLY RED
//   Imports a pure decision function from a module that does not exist yet:
//     api-src/services/inventory/stockProtectionBufferDiagnosis
//   The import fails with MODULE_NOT_FOUND — narrowly attributable to that
//   one missing file. Every assertion below encodes a specific ratified rule
//   from the STOCK-PROTECT-02 contract, so this is not a malformed test.
//
// WHAT IS ASSERTED
//   computeBufferDiagnosis(input) is a PURE function: no DB, no network, no
//   clock dependency beyond stamping `generated_at`. It NEVER reads or
//   writes stock_protection_policies / stock_protection_policy_transitions —
//   its input is pre-gathered evidence, not a trx/shopId/variantId. Producing
//   a recommendation never requires, and must never perform, an approved-
//   policy mutation.
//
//   `demand.demandConfidence` reuses the EXISTING Demand contract verbatim
//   (high/medium/low/none — see demandIntelligence.service.ts). The
//   diagnosis's OWN overall `confidence` output is a distinct scale
//   (insufficient/low/medium/high) that also folds in supplier evidence —
//   these are deliberately not the same enum reused twice.
//
// CORE PRODUCT RULE — NO FAKE PRECISION
//   Insufficient demand evidence (none/low) short-circuits to the baseline
//   with zero adjustments and confidence='insufficient', never a computed
//   number dressed up as personalized.
//
// COVERS: SP-BUF-01 .. SP-BUF-35 (see PR description / audit trail for the
// full ratified enumeration this file protects).
//
// CORRECTION (IMPLEMENTATION_CORRECTION pass): the reason-code lookups below
// were originally written as case-sensitive substring checks
// (`reason_code.includes('VARIABILITY')` etc.), which happened to accept
// any code containing that uppercase fragment — incidental, not the actual
// ratified contract. The ratified vocabulary is the exact, stable, lowercase
// set below (chosen before this file was authored); the lookups now assert
// exact equality against it, and SP-BUF-28b pins the complete vocabulary
// itself so a future rename is caught here rather than discovered
// downstream.
const REASON_CODE = {
  DEMAND_VARIABILITY: 'demand_variability',
  DEMAND_LUMPINESS: 'demand_lumpiness',
  DEMAND_UPWARD_TREND: 'demand_upward_trend',
  SUPPLIER_LATENESS: 'supplier_lateness',
  SUPPLIER_FILL_RISK: 'supplier_fill_risk',
} as const;

import { computeBufferDiagnosis } from 'api-src/services/inventory/stockProtectionBufferDiagnosis';

const BASELINE = 5;
const CAP = 10;

function demand(overrides: Partial<{
  demandConfidence: 'high' | 'medium' | 'low' | 'none';
  velocityWindowDays: 30 | 90 | 180 | null;
  coefficientOfVariation: number | null;
  zeroDemandWeekFraction: number | null;
  hasBurstActivity: boolean;
  trendPercentChange: number | null;
}> = {}) {
  return {
    demandConfidence: 'high' as const,
    velocityWindowDays: 30 as const,
    coefficientOfVariation: 0.2,
    zeroDemandWeekFraction: 0,
    hasBurstActivity: false,
    trendPercentChange: 0,
    ...overrides,
  };
}

function supplier(overrides: Partial<{
  hasEvidence: boolean;
  onTimeRatePercent: number | null;
  fillRatePercent: number | null;
  settledPoCount: number;
  hasPlanningSupplier: boolean;
  hasConfiguredLeadTime: boolean;
}> = {}) {
  return {
    hasEvidence: true,
    onTimeRatePercent: 99,
    fillRatePercent: 99,
    settledPoCount: 20,
    hasPlanningSupplier: true,
    hasConfiguredLeadTime: true,
    ...overrides,
  };
}

describe('STOCK-PROTECT-02 — computeBufferDiagnosis (pure rule)', () => {
  // ── SP-BUF-01 / SP-BUF-02 — baseline and floor ──────────────────────────
  describe('SP-BUF-01/02: baseline is 5, and the recommendation never goes below it', () => {
    it('with zero-adjustment evidence, recommended_safety_days equals the baseline of 5', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ coefficientOfVariation: 0.1, zeroDemandWeekFraction: 0, trendPercentChange: 0 }),
        supplier: supplier({ onTimeRatePercent: 99, fillRatePercent: 99 }),
      });
      expect(result.baseline_safety_days).toBe(BASELINE);
      expect(result.recommended_safety_days).toBe(BASELINE);
      expect(result.recommended_safety_days).toBeGreaterThanOrEqual(BASELINE);
    });

    it('recommended_safety_days is never below 5 for any evidence shape', () => {
      const worstCase = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'none' }),
        supplier: supplier({ hasEvidence: false, onTimeRatePercent: null, fillRatePercent: null }),
      });
      expect(worstCase.recommended_safety_days).toBeGreaterThanOrEqual(BASELINE);
    });
  });

  // ── SP-BUF-03 — cap ──────────────────────────────────────────────────────
  describe('SP-BUF-03: recommended_safety_days is capped at 10', () => {
    it('maximal demand + supplier adjustments still cap at 10', () => {
      const result = computeBufferDiagnosis({
        demand: demand({
          coefficientOfVariation: 1.5,
          zeroDemandWeekFraction: 0.75,
          hasBurstActivity: true,
          trendPercentChange: 0.4,
          demandConfidence: 'high',
        }),
        supplier: supplier({ onTimeRatePercent: 50, fillRatePercent: 50, settledPoCount: 20 }),
      });
      expect(result.recommended_safety_days).toBeLessThanOrEqual(CAP);
      expect(result.recommended_safety_days).toBe(CAP);
    });
  });

  // ── SP-BUF-04 / SP-BUF-05 — insufficient demand short-circuit ───────────
  describe('SP-BUF-04/05: none/low demand confidence short-circuits to baseline + insufficient', () => {
    it.each(['none', 'low'] as const)('demandConfidence=%s -> 5 days, zero adjustments, confidence=insufficient', (level) => {
      const result = computeBufferDiagnosis({
        demand: demand({ demandConfidence: level, coefficientOfVariation: 5, hasBurstActivity: true }),
        supplier: supplier({ onTimeRatePercent: 40, fillRatePercent: 40 }),
      });
      expect(result.recommended_safety_days).toBe(BASELINE);
      expect(result.adjustments).toHaveLength(0);
      expect(result.confidence).toBe('insufficient');
    });
  });

  // ── SP-BUF-06..09 — demand variability (CV) thresholds ──────────────────
  describe('SP-BUF-06..09: demand coefficient-of-variation thresholds', () => {
    it.each([
      { cv: 0.49, expectedDelta: 0, label: 'CV < 0.50 -> +0' },
      { cv: 0.5, expectedDelta: 1, label: 'CV exactly 0.50 -> +1' },
      { cv: 1.0, expectedDelta: 1, label: 'CV exactly 1.00 -> +1' },
      { cv: 1.01, expectedDelta: 2, label: 'CV > 1.00 -> +2' },
    ])('$label', ({ cv, expectedDelta }) => {
      const result = computeBufferDiagnosis({
        demand: demand({ coefficientOfVariation: cv, zeroDemandWeekFraction: 0, trendPercentChange: 0 }),
        supplier: supplier(),
      });
      const cvAdjustment = result.adjustments.find((a) => a.category === 'demand' && a.reason_code === REASON_CODE.DEMAND_VARIABILITY);
      if (expectedDelta === 0) {
        expect(cvAdjustment).toBeUndefined();
      } else {
        expect(cvAdjustment?.delta_days).toBe(expectedDelta);
      }
      expect(result.recommended_safety_days).toBe(BASELINE + expectedDelta);
    });
  });

  // ── SP-BUF-10 / SP-BUF-11 — lumpy demand ────────────────────────────────
  describe('SP-BUF-10/11: lumpy-demand adjustment', () => {
    it('SP-BUF-10: >50% zero-demand weeks WITH burst activity adds +1', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ coefficientOfVariation: 0.1, zeroDemandWeekFraction: 0.6, hasBurstActivity: true, trendPercentChange: 0 }),
        supplier: supplier(),
      });
      const lumpyAdjustment = result.adjustments.find((a) => a.category === 'demand' && a.reason_code === REASON_CODE.DEMAND_LUMPINESS);
      expect(lumpyAdjustment?.delta_days).toBe(1);
      expect(result.recommended_safety_days).toBe(BASELINE + 1);
    });

    it('SP-BUF-11: exactly 50% zero-demand weeks does NOT trigger the lumpy adjustment', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ coefficientOfVariation: 0.1, zeroDemandWeekFraction: 0.5, hasBurstActivity: true, trendPercentChange: 0 }),
        supplier: supplier(),
      });
      const lumpyAdjustment = result.adjustments.find((a) => a.category === 'demand' && a.reason_code === REASON_CODE.DEMAND_LUMPINESS);
      expect(lumpyAdjustment).toBeUndefined();
    });
  });

  // ── SP-BUF-12 — trend adjustment gated on sufficient evidence ───────────
  describe('SP-BUF-12: upward trend >=25% adds +1 only with sufficient (high-confidence) demand evidence', () => {
    it('demandConfidence=high with trend >=25% adds +1', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'high', coefficientOfVariation: 0.1, trendPercentChange: 0.3 }),
        supplier: supplier(),
      });
      const trendAdjustment = result.adjustments.find((a) => a.category === 'demand' && a.reason_code === REASON_CODE.DEMAND_UPWARD_TREND);
      expect(trendAdjustment?.delta_days).toBe(1);
    });

    it('demandConfidence=medium with trend >=25% does NOT add the trend adjustment (insufficient evidence for a trend claim)', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'medium', coefficientOfVariation: 0.1, trendPercentChange: 0.3 }),
        supplier: supplier(),
      });
      const trendAdjustment = result.adjustments.find((a) => a.category === 'demand' && a.reason_code === REASON_CODE.DEMAND_UPWARD_TREND);
      expect(trendAdjustment).toBeUndefined();
    });
  });

  // ── SP-BUF-13 — demand cap ───────────────────────────────────────────────
  describe('SP-BUF-13: demand-side additions are capped at +3 regardless of how many demand signals fire', () => {
    it('CV>1.00 (+2) + lumpy (+1) + trend (+1) would sum to +4 but caps at +3', () => {
      const result = computeBufferDiagnosis({
        demand: demand({
          demandConfidence: 'high',
          coefficientOfVariation: 1.5,
          zeroDemandWeekFraction: 0.75,
          hasBurstActivity: true,
          trendPercentChange: 0.3,
        }),
        supplier: supplier({ onTimeRatePercent: 99, fillRatePercent: 99 }),
      });
      const demandTotal = result.adjustments
        .filter((a) => a.category === 'demand')
        .reduce((sum, a) => sum + a.delta_days, 0);
      expect(demandTotal).toBeLessThanOrEqual(3);
      expect(demandTotal).toBe(3);
    });
  });

  // ── SP-BUF-14 — missing supplier evidence ───────────────────────────────
  describe('SP-BUF-14: missing supplier evidence adds 0 days (never guessed)', () => {
    it('hasEvidence=false contributes no supplier-side adjustment', () => {
      const result = computeBufferDiagnosis({
        demand: demand(),
        supplier: supplier({ hasEvidence: false, onTimeRatePercent: null, fillRatePercent: null, settledPoCount: 0 }),
      });
      const supplierTotal = result.adjustments
        .filter((a) => a.category === 'supplier')
        .reduce((sum, a) => sum + a.delta_days, 0);
      expect(supplierTotal).toBe(0);
    });
  });

  // ── SP-BUF-15..17 — on-time rate thresholds ─────────────────────────────
  describe('SP-BUF-15..17: on-time rate thresholds', () => {
    it.each([
      { onTime: 95, expectedDelta: 0, label: '>=95 -> +0' },
      { onTime: 99.9, expectedDelta: 0, label: '>=95 (upper) -> +0' },
      { onTime: 94.9, expectedDelta: 1, label: '85-94.9 -> +1 (upper bound)' },
      { onTime: 85, expectedDelta: 1, label: '85-94.9 -> +1 (lower bound)' },
      { onTime: 84.9, expectedDelta: 2, label: '<85 -> +2' },
    ])('$label', ({ onTime, expectedDelta }) => {
      const result = computeBufferDiagnosis({
        demand: demand(),
        supplier: supplier({ onTimeRatePercent: onTime, fillRatePercent: 99 }),
      });
      const onTimeAdjustment = result.adjustments.find((a) => a.category === 'supplier' && a.reason_code === REASON_CODE.SUPPLIER_LATENESS);
      if (expectedDelta === 0) {
        expect(onTimeAdjustment).toBeUndefined();
      } else {
        expect(onTimeAdjustment?.delta_days).toBe(expectedDelta);
      }
    });
  });

  // ── SP-BUF-18..20 — fill rate thresholds ────────────────────────────────
  describe('SP-BUF-18..20: fill rate thresholds', () => {
    it.each([
      { fill: 98, expectedDelta: 0, label: '>=98 -> +0' },
      { fill: 97.9, expectedDelta: 1, label: '95-97.9 -> +1 (upper bound)' },
      { fill: 95, expectedDelta: 1, label: '95-97.9 -> +1 (lower bound)' },
      { fill: 94.9, expectedDelta: 2, label: '<95 -> +2' },
    ])('$label', ({ fill, expectedDelta }) => {
      const result = computeBufferDiagnosis({
        demand: demand(),
        supplier: supplier({ onTimeRatePercent: 99, fillRatePercent: fill }),
      });
      const fillAdjustment = result.adjustments.find((a) => a.category === 'supplier' && a.reason_code === REASON_CODE.SUPPLIER_FILL_RISK);
      if (expectedDelta === 0) {
        expect(fillAdjustment).toBeUndefined();
      } else {
        expect(fillAdjustment?.delta_days).toBe(expectedDelta);
      }
    });
  });

  // ── SP-BUF-21 — supplier cap ─────────────────────────────────────────────
  describe('SP-BUF-21: supplier-side additions are capped at +2', () => {
    it('on-time <85 (+2) + fill <95 (+2) would sum to +4 but caps at +2', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ coefficientOfVariation: 0.1, trendPercentChange: 0 }),
        supplier: supplier({ onTimeRatePercent: 50, fillRatePercent: 50 }),
      });
      const supplierTotal = result.adjustments
        .filter((a) => a.category === 'supplier')
        .reduce((sum, a) => sum + a.delta_days, 0);
      expect(supplierTotal).toBeLessThanOrEqual(2);
      expect(supplierTotal).toBe(2);
    });
  });

  // ── SP-BUF-22 — lead_time_days is not a safety-day input ────────────────
  describe('SP-BUF-22: lead_time_days itself never adds safety days', () => {
    it('the input contract has no lead_time_days field for supplier evidence at all', () => {
      const result = computeBufferDiagnosis({
        demand: demand(),
        supplier: supplier(),
      });
      // The supplier evidence object recorded in the diagnosis must not carry
      // a lead-time field — lead time is a planning input consumed
      // separately by demandIntelligence.service.ts, never a buffer-sizing
      // input here.
      expect(result.evidence.supplier).not.toHaveProperty('lead_time_days');
      expect(result.evidence.supplier).not.toHaveProperty('leadTimeDays');
    });
  });

  // ── SP-BUF-23..26 — overall confidence tiers ────────────────────────────
  describe('SP-BUF-23..26: overall confidence reuses demand_confidence as one input, but is its own scale', () => {
    it('SP-BUF-23: insufficient when demand confidence is none or low', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'low' }),
        supplier: supplier({ settledPoCount: 50 }),
      });
      expect(result.confidence).toBe('insufficient');
    });

    it('SP-BUF-24: low when demand confidence is medium, OR high demand with absent supplier evidence', () => {
      const mediumDemand = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'medium' }),
        supplier: supplier({ settledPoCount: 50 }),
      });
      expect(mediumDemand.confidence).toBe('low');

      const highDemandNoSupplier = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'high' }),
        supplier: supplier({ hasEvidence: false, settledPoCount: 0, onTimeRatePercent: null, fillRatePercent: null }),
      });
      expect(highDemandNoSupplier.confidence).toBe('low');
    });

    it('SP-BUF-25: medium when demand confidence is high and >=3 completed supplier POs', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'high' }),
        supplier: supplier({ settledPoCount: 3 }),
      });
      expect(result.confidence).toBe('medium');
    });

    it('SP-BUF-26: high when demand confidence is high, >=15 completed POs, and required supplier evidence is populated', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'high' }),
        supplier: supplier({ settledPoCount: 15, onTimeRatePercent: 96, fillRatePercent: 98 }),
      });
      expect(result.confidence).toBe('high');
    });

    it('SP-BUF-27: buffer size (recommended_safety_days) does not determine confidence', () => {
      // Two inputs that produce the SAME recommended_safety_days but
      // different confidence tiers, proving confidence is not derived from
      // the numeric output.
      const lowConfidenceSameBuffer = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'medium', coefficientOfVariation: 0.1, trendPercentChange: 0 }),
        supplier: supplier({ settledPoCount: 50, onTimeRatePercent: 99, fillRatePercent: 99 }),
      });
      const highConfidenceSameBuffer = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'high', coefficientOfVariation: 0.1, trendPercentChange: 0 }),
        supplier: supplier({ settledPoCount: 15, onTimeRatePercent: 99, fillRatePercent: 99 }),
      });
      expect(lowConfidenceSameBuffer.recommended_safety_days).toBe(highConfidenceSameBuffer.recommended_safety_days);
      expect(lowConfidenceSameBuffer.confidence).not.toBe(highConfidenceSameBuffer.confidence);
    });
  });

  // ── SP-BUF-28..32 — explanation contract ────────────────────────────────
  describe('SP-BUF-28..32: the explanation contract is complete and durable', () => {
    it('SP-BUF-28: every non-zero adjustment carries a durable reason_code', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ coefficientOfVariation: 1.2, hasBurstActivity: true, zeroDemandWeekFraction: 0.6 }),
        supplier: supplier({ onTimeRatePercent: 80, fillRatePercent: 90 }),
      });
      expect(result.adjustments.length).toBeGreaterThan(0);
      for (const adjustment of result.adjustments) {
        expect(typeof adjustment.reason_code).toBe('string');
        expect(adjustment.reason_code.length).toBeGreaterThan(0);
      }
    });

    it('SP-BUF-29: arithmetic is explainable — baseline + sum(adjustments) equals the recommendation, before capping', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ coefficientOfVariation: 0.6 }),
        supplier: supplier({ onTimeRatePercent: 90, fillRatePercent: 99 }),
      });
      const totalAdjustment = result.adjustments.reduce((sum, a) => sum + a.delta_days, 0);
      expect(result.recommended_safety_days).toBe(
        Math.min(CAP, Math.max(BASELINE, result.baseline_safety_days + totalAdjustment))
      );
    });

    it('SP-BUF-30: limitations are emitted for the insufficient-evidence case', () => {
      const result = computeBufferDiagnosis({
        demand: demand({ demandConfidence: 'none' }),
        supplier: supplier({ hasEvidence: false }),
      });
      expect(Array.isArray(result.limitations)).toBe(true);
      expect(result.limitations.length).toBeGreaterThan(0);
    });

    it('SP-BUF-31: the output includes the evidence it was computed from', () => {
      const demandEvidence = demand({ coefficientOfVariation: 0.3 });
      const supplierEvidence = supplier({ onTimeRatePercent: 97 });
      const result = computeBufferDiagnosis({ demand: demandEvidence, supplier: supplierEvidence });
      expect(result.evidence.demand).toMatchObject({ coefficientOfVariation: 0.3 });
      expect(result.evidence.supplier).toMatchObject({ onTimeRatePercent: 97 });
    });

    it('SP-BUF-32: generated_at is present and is a valid ISO timestamp', () => {
      const result = computeBufferDiagnosis({ demand: demand(), supplier: supplier() });
      expect(typeof result.generated_at).toBe('string');
      expect(Number.isNaN(new Date(result.generated_at).getTime())).toBe(false);
    });

    it('SP-BUF-33: the function is pure — no transaction/database handle is part of its input contract', () => {
      // computeBufferDiagnosis takes ONLY pre-gathered evidence, never a
      // Knex transaction, shopId, or variantId — a recommendation can be
      // recalculated freely without ever touching stock_protection_policies.
      expect(computeBufferDiagnosis.length).toBeLessThanOrEqual(1);
    });

    it('SP-BUF-28b: every adjustment reason_code is drawn from the exact, stable, lowercase vocabulary', () => {
      const stableVocabulary = new Set(Object.values(REASON_CODE));
      const result = computeBufferDiagnosis({
        demand: demand({
          coefficientOfVariation: 1.2,
          zeroDemandWeekFraction: 0.6,
          hasBurstActivity: true,
          trendPercentChange: 0.3,
        }),
        supplier: supplier({ onTimeRatePercent: 80, fillRatePercent: 90 }),
      });
      expect(result.adjustments.length).toBeGreaterThan(0);
      for (const adjustment of result.adjustments) {
        expect(stableVocabulary.has(adjustment.reason_code)).toBe(true);
      }
    });
  });

  // ── SP-BUF-34 / SP-BUF-35 — supplier-identity limitations ───────────────
  describe('SP-BUF-34/35: no_planning_supplier and no_configured_lead_time limitations', () => {
    it('SP-BUF-34: no planning supplier resolved at all -> limitation no_planning_supplier, no safety days added, no failure', () => {
      const result = computeBufferDiagnosis({
        demand: demand(),
        supplier: supplier({
          hasPlanningSupplier: false,
          hasConfiguredLeadTime: false,
          hasEvidence: false,
          onTimeRatePercent: null,
          fillRatePercent: null,
          settledPoCount: 0,
        }),
      });
      expect(result.limitations).toContain('no_planning_supplier');
      // Never contradictory: the more fundamental gap subsumes the others.
      expect(result.limitations).not.toContain('no_configured_lead_time');
      expect(result.limitations).not.toContain('supplier_metrics_unavailable');
      expect(result.limitations).not.toContain('insufficient_supplier_history');
      const supplierAdjustmentTotal = result.adjustments
        .filter((a) => a.category === 'supplier')
        .reduce((sum, a) => sum + a.delta_days, 0);
      expect(supplierAdjustmentTotal).toBe(0);
      expect(result.recommended_safety_days).toBe(BASELINE);
    });

    it('SP-BUF-35: a planning supplier exists but has no configured lead time -> limitation no_configured_lead_time, no safety days added, no failure', () => {
      const result = computeBufferDiagnosis({
        demand: demand(),
        supplier: supplier({ hasPlanningSupplier: true, hasConfiguredLeadTime: false }),
      });
      expect(result.limitations).toContain('no_configured_lead_time');
      expect(result.limitations).not.toContain('no_planning_supplier');
      // Settled on-time/fill evidence (from supplier()'s defaults) still
      // contributes normally — a missing configured lead time does not
      // itself add or remove any safety-day adjustment.
      const supplierAdjustmentTotal = result.adjustments
        .filter((a) => a.category === 'supplier')
        .reduce((sum, a) => sum + a.delta_days, 0);
      expect(supplierAdjustmentTotal).toBe(0);
      expect(result.recommended_safety_days).toBe(BASELINE);
    });
  });
});
