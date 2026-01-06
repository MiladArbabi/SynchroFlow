//modules/analytics/src/ui/pages/AnalyticsModuleFT2.tsx

import React from 'react';
import type { AnalyticsModuleFT2Props } from './AnalyticsModuleFT2.types';

export default function AnalyticsModuleFT2(
  props: AnalyticsModuleFT2Props
) {
  const {
    context,
    coherenceSignal,
    volatilitySignal,
    blindSpots,
    timeSignal,
  } = props;

  return (
    <section>
      <h2>Analytics (FT2)</h2>

      <div>
        <strong>Period:</strong>{' '}
        {context.period.from} → {context.period.to}
      </div>

      <div>
        <strong>Signals analyzed:</strong>{' '}
        {context.signalsAnalyzed ?? '—'}
      </div>

      <hr />

      <div>
        <strong>Coherence:</strong>{' '}
        {coherenceSignal
          ? `${coherenceSignal.state} (${coherenceSignal.confidence})`
          : '—'}
      </div>

      <div>
        <strong>Volatility:</strong>{' '}
        {volatilitySignal
          ? `${volatilitySignal.level} (${volatilitySignal.variancePct ?? '—'}%)`
          : '—'}
      </div>

      <div>
        <strong>Blind spots:</strong>
        {blindSpots ? (
          <ul>
            {blindSpots.map((b, i) => (
              <li key={i}>
                [{b.domain}] {b.description} ({b.confidence})
              </li>
            ))}
          </ul>
        ) : (
          ' —'
        )}
      </div>

      <div>
        <strong>Time signal:</strong>{' '}
        {timeSignal ? timeSignal.trend : '—'}
      </div>
    </section>
  );
}