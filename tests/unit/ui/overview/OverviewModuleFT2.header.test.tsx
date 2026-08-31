// tests/unit/ui/overview/OverviewModuleFT2.header.test.tsx
//
// OV-DATA-02 — Overview semantic contract (OV-SEM correction).
//
// Locks the "Needs a decision" header summary and the per-signal revenue-impact
// label. Imports ONLY the leaf pure-helper module — no React, no Testing
// Library, no component — so the @lasyncro/shared/ui barrel is never loaded.

import {
  buildDecisionPendingSummary,
  revenueImpactLabel,
} from '../../../../modules/overview/src/ui/pages/overviewSemantics';

describe('overview semantics — OV-SEM final contract', () => {
  describe('OV-SEM-01 — decision-pending summary depends only on the decision count', () => {
    it('singular: reports "1 decision pending" with no money', () => {
      const summary = buildDecisionPendingSummary(1);
      expect(summary).toContain('1 decision pending');
      expect(summary).not.toContain('at stake');
      expect(summary).not.toContain('$');
    });

    it('plural: reports "2 decisions pending"', () => {
      expect(buildDecisionPendingSummary(2)).toContain('2 decisions pending');
    });
  });

  describe('OV-SEM-04 / OV-SEM-03 — revenueImpactLabel names the money by alert type', () => {
    it('sla_breach revenue impact is labelled "order value"', () => {
      expect(revenueImpactLabel('sla_breach')).toBe('order value');
    });

    it('revenue_at_risk revenue impact is labelled "blocked revenue"', () => {
      expect(revenueImpactLabel('revenue_at_risk')).toBe('blocked revenue');
    });

    it('an unrelated alert type has no revenue-impact label', () => {
      expect(revenueImpactLabel('stockout_risk')).toBeNull();
    });
  });
});
