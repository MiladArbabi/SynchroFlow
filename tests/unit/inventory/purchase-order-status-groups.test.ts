// tests/unit/inventory/purchase-order-status-groups.test.ts
//
// STOCK-PROTECT-03 — canonical PO-status groupings. PERMANENT regression
// contract, authored RED (module does not exist yet).
// ===========================================================================
// WHAT IS ASSERTED
//   Four distinct, non-collapsed status groupings, per the ratified
//   eligibility-correction design:
//   - RELIABLE_INBOUND_PO_STATUSES: Demand arithmetic only.
//   - RECEIVING_BOUNDARY_PO_STATUSES: participates in BOTH Slice 1 receiving
//     treatment AND Stock Protection eligibility (dual role — not
//     treatment-only).
//   - STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES: draft + receiving boundary
//     ONLY — ordered/confirmed/in_production must NOT appear here, since a
//     committed, pre-arrival PO alone must never wake a dormant SKU.
//   - ACTIVE_REPLENISHMENT_PO_STATUSES: the full evidence-classification
//     superset (draft + committed + receiving boundary).

import {
  RELIABLE_INBOUND_PO_STATUSES,
  RECEIVING_BOUNDARY_PO_STATUSES,
  STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES,
  ACTIVE_REPLENISHMENT_PO_STATUSES,
} from 'api-src/services/inventory/purchaseOrderStatusGroups';

describe('STOCK-PROTECT-03 — canonical PO status groupings', () => {
  it('RELIABLE_INBOUND_PO_STATUSES is exactly ordered/confirmed/in_production', () => {
    expect([...RELIABLE_INBOUND_PO_STATUSES].sort()).toEqual(
      ['confirmed', 'in_production', 'ordered'].sort(),
    );
  });

  it('RECEIVING_BOUNDARY_PO_STATUSES is exactly shipped/partially_received', () => {
    expect([...RECEIVING_BOUNDARY_PO_STATUSES].sort()).toEqual(
      ['partially_received', 'shipped'].sort(),
    );
  });

  it('STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES is exactly draft + receiving boundary', () => {
    expect([...STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES].sort()).toEqual(
      ['draft', 'partially_received', 'shipped'].sort(),
    );
  });

  it('committed statuses (ordered/confirmed/in_production) are NOT in the eligibility set', () => {
    for (const status of RELIABLE_INBOUND_PO_STATUSES) {
      expect(STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES as readonly string[]).not.toContain(status);
    }
  });

  it('ACTIVE_REPLENISHMENT_PO_STATUSES is the full six-status superset', () => {
    expect([...ACTIVE_REPLENISHMENT_PO_STATUSES].sort()).toEqual(
      ['confirmed', 'draft', 'in_production', 'ordered', 'partially_received', 'shipped'].sort(),
    );
  });

  it('terminal statuses (received/cancelled) appear in none of the four groups', () => {
    const allGroups = [
      ...RELIABLE_INBOUND_PO_STATUSES,
      ...RECEIVING_BOUNDARY_PO_STATUSES,
      ...STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES,
      ...ACTIVE_REPLENISHMENT_PO_STATUSES,
    ];
    expect(allGroups).not.toContain('received');
    expect(allGroups).not.toContain('cancelled');
  });
});
