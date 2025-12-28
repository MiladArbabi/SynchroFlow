import React from 'react';
import { OrderNexusUiIntent } from './intents';

interface OrderNexusAhaSummary {
  hasRisk: boolean;
  riskCount: number;
  severity: 'low' | 'medium' | 'high';
}

interface OrderNexusAhaPanelProps {
  summary: OrderNexusAhaSummary;
  onIntent: (intent: OrderNexusUiIntent) => void;
}

export function OrderNexusAhaPanel({
  summary,
  onIntent,
}: OrderNexusAhaPanelProps) {
  if (!summary.hasRisk) {
    return null;
  }

  return (
    <section data-testid="order-nexus-aha-panel">
      <h2>Order profitability risk detected</h2>

      <p>
        {summary.riskCount} order
        {summary.riskCount > 1 ? 's' : ''} may be losing money.
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
