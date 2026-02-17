import React from 'react';
import { FinancesUiIntent } from './intents.js';

interface FinancesAhaSummary {
  hasRisk: boolean;
  riskCount: number;
  severity: 'low' | 'medium' | 'high';
}

interface FinancesAhaPanelProps {
  summary: FinancesAhaSummary;
  onIntent: (intent: FinancesUiIntent) => void;
}

export function FinancesAhaPanel({
  summary,
  onIntent,
}: FinancesAhaPanelProps) {
  if (!summary.hasRisk) {
    return null;
  }

  return (
    <section data-testid="finances-aha-panel">
      <h2>Financial risk detected</h2>

      <p>
        {summary.riskCount} financial data point
        {summary.riskCount > 1 ? 's' : ''} are potentially at risk.
      </p>

      <button
        type="button"
        onClick={() => onIntent({ type: 'START_ONBOARDING' })}
      >
        Fix this
      </button>
    </section>
  );
}
