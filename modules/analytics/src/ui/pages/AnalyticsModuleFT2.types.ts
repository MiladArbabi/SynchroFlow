/**
 * AnalyticsModuleFT2DataProps
 * ==========================
 *
 * DATA-ONLY FT2 contract for Analytics.
 *
 * Rules:
 * - Shape-stable
 * - Read-only
 * - No intelligence
 * - Uncertainty expressed ONLY via `null`
 */
export interface AnalyticsModuleFT2DataProps {
  context: {
    period: {
      from: string;
      to: string;
    };
  };

  outcome: {
    status: 'positive' | 'negative';
  } | null;

  trend: {
    direction: 'unknown';
  } | null;
}

/**
 * AnalyticsModuleFT2Props
 * ======================
 *
 * FULL render contract.
 *
 * - Extends data props
 * - Visuals injected
 */
export interface AnalyticsModuleFT2Props
  extends AnalyticsModuleFT2DataProps {
  timeline: React.ReactNode;
  distribution: React.ReactNode;
}