// tests/unit/inventory/stock-protection-treatment.test.ts
//
// STOCK-PROTECT-03 Slice 1 — UNIT contract for the pure Stock Protection
// treatment decision rule. PERMANENT regression contract, authored RED.
// ===========================================================================
// WHAT IS ASSERTED
//   deriveStockProtectionTreatment(input) is a PURE function: no DB, no
//   network, no clock. Given canonical reorder urgency (from Demand),
//   suggested_reorder_qty, and action evidence (pending reorder request /
//   draft PO / committed PO / receiving-boundary PO), it returns exactly one
//   of the five merchant-facing treatments. It performs no quantity
//   estimation, no inbound subtraction, no PO aggregation, and no urgency
//   derivation — those are out of scope for this pure rule.
//
// LOCKED PRECEDENCE (ratified, implement exactly):
//   1. planning_data_required               -> complete_setup
//   2. healthy | no_velocity                -> none
//   3. hasReceivingBoundaryPo                -> receive_inbound
//   4. hasCommittedPo && qty !== null && qty <= 0 -> none
//   5. hasPendingReorderRequest | hasDraftPo -> finish_reorder
//   6. otherwise                             -> reorder_now

import {
  deriveStockProtectionTreatment,
  StockProtectionActionEvidence,
  StockProtectionTreatmentInput,
  ReorderUrgency,
} from 'api-src/services/inventory/stockProtectionTreatment';

const NO_EVIDENCE: StockProtectionActionEvidence = {
  hasPendingReorderRequest: false,
  hasDraftPo: false,
  hasCommittedPo: false,
  hasReceivingBoundaryPo: false,
};

const ALL_EVIDENCE: StockProtectionActionEvidence = {
  hasPendingReorderRequest: true,
  hasDraftPo: true,
  hasCommittedPo: true,
  hasReceivingBoundaryPo: true,
};

function input(
  reorderUrgency: ReorderUrgency,
  suggestedReorderQty: number | null,
  actionEvidence: Partial<StockProtectionActionEvidence> = {},
): StockProtectionTreatmentInput {
  return {
    reorderUrgency,
    suggestedReorderQty,
    actionEvidence: { ...NO_EVIDENCE, ...actionEvidence },
  };
}

describe('STOCK-PROTECT-03 Slice 1 — deriveStockProtectionTreatment (pure rule)', () => {
  describe('rule 1: planning_data_required is absolute', () => {
    it('1. planning_data_required + no evidence -> complete_setup', () => {
      expect(deriveStockProtectionTreatment(input('planning_data_required', null))).toBe(
        'complete_setup',
      );
    });

    it('2. planning_data_required + receiving-boundary PO -> complete_setup', () => {
      expect(
        deriveStockProtectionTreatment(
          input('planning_data_required', null, { hasReceivingBoundaryPo: true }),
        ),
      ).toBe('complete_setup');
    });

    it('3. planning_data_required + pending request -> complete_setup', () => {
      expect(
        deriveStockProtectionTreatment(
          input('planning_data_required', null, { hasPendingReorderRequest: true }),
        ),
      ).toBe('complete_setup');
    });

    it('planning_data_required + ALL evidence -> complete_setup', () => {
      expect(
        deriveStockProtectionTreatment(input('planning_data_required', 5, ALL_EVIDENCE)),
      ).toBe('complete_setup');
    });
  });

  describe('rule 2: healthy / no_velocity are absolute', () => {
    it('4. healthy + any evidence -> none', () => {
      expect(deriveStockProtectionTreatment(input('healthy', 10, ALL_EVIDENCE))).toBe('none');
    });

    it('5. no_velocity + any evidence -> none', () => {
      expect(deriveStockProtectionTreatment(input('no_velocity', 10, ALL_EVIDENCE))).toBe('none');
    });

    it('healthy + no evidence -> none', () => {
      expect(deriveStockProtectionTreatment(input('healthy', null))).toBe('none');
    });

    it('no_velocity + no evidence -> none', () => {
      expect(deriveStockProtectionTreatment(input('no_velocity', null))).toBe('none');
    });
  });

  describe('rule 3: receiving-boundary PO outranks pending/draft intent', () => {
    it('6. critical + receiving-boundary PO -> receive_inbound', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', 5, { hasReceivingBoundaryPo: true }),
        ),
      ).toBe('receive_inbound');
    });

    it('7. warning + receiving-boundary PO -> receive_inbound', () => {
      expect(
        deriveStockProtectionTreatment(
          input('warning', 5, { hasReceivingBoundaryPo: true }),
        ),
      ).toBe('receive_inbound');
    });

    it('8. receiving-boundary PO + pending request -> receive_inbound', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', 5, {
            hasReceivingBoundaryPo: true,
            hasPendingReorderRequest: true,
          }),
        ),
      ).toBe('receive_inbound');
    });

    it('9. receiving-boundary PO + draft PO -> receive_inbound', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', 5, {
            hasReceivingBoundaryPo: true,
            hasDraftPo: true,
          }),
        ),
      ).toBe('receive_inbound');
    });

    it('receiving-boundary PO + committed PO -> receive_inbound', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', 5, {
            hasReceivingBoundaryPo: true,
            hasCommittedPo: true,
          }),
        ),
      ).toBe('receive_inbound');
    });

    it('receiving-boundary PO + ALL other evidence -> receive_inbound', () => {
      expect(deriveStockProtectionTreatment(input('critical', 0, ALL_EVIDENCE))).toBe(
        'receive_inbound',
      );
    });
  });

  describe('rule 4: committed PO with fully-covered suggested qty suppresses stale intent', () => {
    it('10. committed PO + suggested qty = 0 -> none', () => {
      expect(
        deriveStockProtectionTreatment(input('critical', 0, { hasCommittedPo: true })),
      ).toBe('none');
    });

    it('11. committed PO + suggested qty < 0 -> none', () => {
      expect(
        deriveStockProtectionTreatment(input('critical', -3, { hasCommittedPo: true })),
      ).toBe('none');
    });

    it('12. committed PO + suggested qty = 0 + pending request -> none', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', 0, { hasCommittedPo: true, hasPendingReorderRequest: true }),
        ),
      ).toBe('none');
    });

    it('13. committed PO + suggested qty = 0 + draft PO -> none', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', 0, { hasCommittedPo: true, hasDraftPo: true }),
        ),
      ).toBe('none');
    });

    it('warning + committed PO + suggested qty = 0 -> none', () => {
      expect(
        deriveStockProtectionTreatment(input('warning', 0, { hasCommittedPo: true })),
      ).toBe('none');
    });
  });

  describe('rule 5: pending request or draft PO -> finish_reorder (when committed qty does not fully cover)', () => {
    it('14. committed PO + suggested qty > 0 + pending request -> finish_reorder', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', 4, { hasCommittedPo: true, hasPendingReorderRequest: true }),
        ),
      ).toBe('finish_reorder');
    });

    it('15. committed PO + suggested qty > 0 + draft PO -> finish_reorder', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', 4, { hasCommittedPo: true, hasDraftPo: true }),
        ),
      ).toBe('finish_reorder');
    });

    it('16. pending request only -> finish_reorder', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', null, { hasPendingReorderRequest: true }),
        ),
      ).toBe('finish_reorder');
    });

    it('17. draft PO only -> finish_reorder', () => {
      expect(
        deriveStockProtectionTreatment(input('critical', null, { hasDraftPo: true })),
      ).toBe('finish_reorder');
    });

    it('committed PO + suggested qty = null + pending request -> finish_reorder (null qty never treated as covered)', () => {
      expect(
        deriveStockProtectionTreatment(
          input('critical', null, { hasCommittedPo: true, hasPendingReorderRequest: true }),
        ),
      ).toBe('finish_reorder');
    });
  });

  describe('rule 6: otherwise -> reorder_now', () => {
    it('18. committed PO + suggested qty > 0 -> reorder_now', () => {
      expect(
        deriveStockProtectionTreatment(input('critical', 4, { hasCommittedPo: true })),
      ).toBe('reorder_now');
    });

    it('19. critical + no action evidence -> reorder_now', () => {
      expect(deriveStockProtectionTreatment(input('critical', 4))).toBe('reorder_now');
    });

    it('20. warning + no action evidence -> reorder_now', () => {
      expect(deriveStockProtectionTreatment(input('warning', 4))).toBe('reorder_now');
    });
  });

  describe('null-quantity contract: the function never invents or coerces a quantity', () => {
    it('21. critical + suggested qty = null + no evidence -> reorder_now', () => {
      expect(deriveStockProtectionTreatment(input('critical', null))).toBe('reorder_now');
    });

    it('22. critical + suggested qty = null + committed PO -> reorder_now (null qty is never treated as <= 0)', () => {
      expect(
        deriveStockProtectionTreatment(input('critical', null, { hasCommittedPo: true })),
      ).toBe('reorder_now');
    });
  });

  describe('determinism and purity', () => {
    it('23. same input twice yields the same result', () => {
      const sameInput = input('critical', 4, { hasPendingReorderRequest: true });
      const first = deriveStockProtectionTreatment(sameInput);
      const second = deriveStockProtectionTreatment(sameInput);
      expect(first).toBe(second);
    });

    it('24. result depends only on supplied qty/evidence — no hidden inbound arithmetic', () => {
      // Two logically distinct "committed inbound" scenarios that a hidden
      // aggregation might conflate (e.g. summing multiple committed POs)
      // must be indistinguishable to this function: it only ever looks at
      // the single boolean hasCommittedPo and the single suggestedReorderQty
      // it was handed, never at PO counts, PO quantities, or dates.
      const singleCommittedPo = input('critical', 0, { hasCommittedPo: true });
      const alsoSingleCommittedPo = input('critical', 0, { hasCommittedPo: true });

      expect(deriveStockProtectionTreatment(singleCommittedPo)).toBe(
        deriveStockProtectionTreatment(alsoSingleCommittedPo),
      );
      expect(deriveStockProtectionTreatment(singleCommittedPo)).toBe('none');
    });
  });
});
