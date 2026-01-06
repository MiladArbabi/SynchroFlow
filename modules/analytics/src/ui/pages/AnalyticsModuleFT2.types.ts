// modules/analytics/src/ui/pages/AnalyticsModuleFT2.types.ts

export interface AnalyticsModuleFT2Props {
  context: {
    period: {
      from: string;
      to: string;
    };
    signalsAnalyzed: number | null;
  };

  coherenceSignal: {
    state: 'coherent' | 'fragmented' | 'contradictory' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
  } | null;

  volatilitySignal: {
    level: 'stable' | 'volatile' | 'chaotic' | 'unknown';
    variancePct: number | null;
  } | null;

  blindSpots: Array<{
    domain: 'orders' | 'finances' | 'products' | 'customers' | 'unknown';
    description: string;
    confidence: 'high' | 'medium' | 'low';
  }> | null;

  timeSignal: {
    trend:
      | 'improving'
      | 'deteriorating'
      | 'stable'
      | 'volatile'
      | 'unknown';
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
}