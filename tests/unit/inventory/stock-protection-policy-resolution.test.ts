// tests/unit/inventory/stock-protection-policy-resolution.test.ts
//
// STOCK-PROTECT-01 — UNIT contract for the pure effective-policy resolution
// rule. PERMANENT regression contract, authored RED.
// ===========================================================================
// INDEPENDENTLY RED
//   This suite imports a single pure decision function from a module that
//   does not exist yet:
//     api-src/services/inventory/stockProtectionPolicyResolution
//   The import fails with MODULE_NOT_FOUND. That failure is narrowly
//   attributable to ONE missing file and is the legitimate RED signal for
//   surface B (effective policy resolution missing) — it is not a malformed
//   test: every assertion below encodes a specific ratified behaviour
//   (contract items 2, 3, 4) that the ratified function is required to
//   satisfy once it exists.
//
// WHAT IS ASSERTED
//   resolveEffectivePolicy(currentRow) is a PURE function: no DB, no
//   network, no clock. Given the persisted current-authority row (or null,
//   meaning no approved policy exists for this shop+variant), it returns the
//   effective planning inputs. Derived intelligence (velocity, current
//   stock, buffer units, reorder point, stockout date, suggested reorder
//   qty, urgency) is never part of ITS input contract and never leaks into
//   its output — it is not policy authority (contract item 3).
//
// COVERS: SP-POL-02, SP-POL-03, SP-POL-04

import { resolveEffectivePolicy } from 'api-src/services/inventory/stockProtectionPolicyResolution';

describe('STOCK-PROTECT-01 — resolveEffectivePolicy (pure rule)', () => {
  // ── SP-POL-04 ─────────────────────────────────────────────────────────────
  describe('SP-POL-04: no approved policy preserves effective legacy behaviour', () => {
    it('returns safety_days=5, review_cycle_days=7, source=system_default for a null current row', () => {
      const effective = resolveEffectivePolicy(null);
      expect(effective).toMatchObject({
        safety_days: 5,
        review_cycle_days: 7,
        source: 'system_default',
        planning_supplier_id: null,
      });
    });
  });

  // ── SP-POL-02 ─────────────────────────────────────────────────────────────
  describe('SP-POL-02: an approved merchant configuration is the authority', () => {
    it('returns the approved row values verbatim, not a re-derived value', () => {
      const approved = {
        version: 3,
        safety_days: 12,
        review_cycle_days: 14,
        planning_supplier_id: 42,
        source: 'merchant_approved' as const,
        approved_by_actor_type: 'user',
        approved_by_actor_id: 'user-9',
        approved_at: new Date('2026-08-01T00:00:00.000Z'),
      };

      const effective = resolveEffectivePolicy(approved);

      expect(effective).toMatchObject({
        safety_days: 12,
        review_cycle_days: 14,
        planning_supplier_id: 42,
        source: 'merchant_approved',
        version: 3,
      });
    });
  });

  // ── SP-POL-03 ─────────────────────────────────────────────────────────────
  describe('SP-POL-03: derived intelligence is never stored/returned as current authority', () => {
    it('ignores derived-intelligence fields attached to the approved row and does not echo them', () => {
      const approvedWithDerivedNoise = {
        version: 1,
        safety_days: 8,
        review_cycle_days: 9,
        planning_supplier_id: 7,
        source: 'merchant_approved' as const,
        approved_by_actor_type: 'user',
        approved_by_actor_id: 'user-1',
        approved_at: new Date('2026-08-01T00:00:00.000Z'),
        // Derived intelligence — must never be treated as, or echoed as,
        // policy authority (contract item 3).
        velocity: 99,
        current_stock: 1000,
        buffer_units: 500,
        reorder_point: 250,
        stockout_date: '2026-09-01',
        suggested_reorder_qty: 750,
        urgency: 'critical',
      } as Record<string, unknown>;

      const effective = resolveEffectivePolicy(approvedWithDerivedNoise as any);

      expect(effective).not.toHaveProperty('velocity');
      expect(effective).not.toHaveProperty('current_stock');
      expect(effective).not.toHaveProperty('buffer_units');
      expect(effective).not.toHaveProperty('reorder_point');
      expect(effective).not.toHaveProperty('stockout_date');
      expect(effective).not.toHaveProperty('suggested_reorder_qty');
      expect(effective).not.toHaveProperty('urgency');
      // The authoritative fields themselves are still correct despite the noise.
      expect(effective.safety_days).toBe(8);
      expect(effective.review_cycle_days).toBe(9);
    });
  });
});
