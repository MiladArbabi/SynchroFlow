// modules/shared/src/contracts/finances-intelligence.ts
//
// Canonical cross-module contract for Finances Intelligence trust signals.
// Originally lived inline in two places (the frontend hook and the
// finances module's prop types) — moved here 2026-06-24 per the UX-sweep
// TECH-DEBT note in finances-module-architecture.md §10. Both the
// Intelligence hook and the Margin module's ProfitTrustPanel consume this
// shape; keep it as the single source of truth.

export type FinancesComparison = {
  period: { from: string; to: string };
  prior:  { from: string; to: string };
  delta: {
    revenuePct:       number | null;
    marginPct:        number | null;
    netMarginPct:     number | null;
    refundsPct:       number | null;
    avgMarginPtDelta: number;
  };
  priorTotals: {
    totalRevenue: number;
    totalMargin: number;
    totalRefunds: number;
    netMargin: number;
    avgMarginPct: number;
  };
};

export type FinancesIntelligenceData = {
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  avgMarginPct: number;
  totalRefunds: number;
  netMargin: number;
  netMarginPct: number | null;
  negativemarginOrders: number;
  costCoverage: {
    totalVariants: number;
    zeroCostCount: number;
    coveragePct: number | null;
  };
  blockedRevenue: number | null;
  blockedMarginValue: number | null;
  constrainedOrders: number | null;
  totalShippingCost: number | null;
  // FIN-01 (2026-06-23): true-margin surface + presence flag.
  // NULL until a carrier label exists (WM-39); drives the honest
  // gross-vs-true headline switch in FinancesIntelligencePage.
  trueMargin: number | null;
  trueMarginPct: number | null;
  hasCarrierData: boolean;
  // UX-sweep 2026-06-23: prior-period delta for "How am I doing?" framing.
  comparison: FinancesComparison | null;
};