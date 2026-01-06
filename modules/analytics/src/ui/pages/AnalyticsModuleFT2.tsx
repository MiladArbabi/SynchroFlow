/**
 * AnalyticsModuleFT2
 * ==================
 *
 * Purpose:
 * --------
 * Passive, read-only observability surface for Analytics FT2.
 *
 * This component:
 * - Renders facts only
 * - Contains ZERO business logic
 * - Performs ZERO interpretation
 *
 * Rendering Rules (LOCKED):
 * ------------------------
 * - All nulls render as "—"
 * - No conditional hiding (except null vs value)
 * - No explanations
 * - No calls to action
 *
 * If this component ever feels "helpful",
 * something has gone wrong.
 */

import React from 'react';
import type { AnalyticsModuleFT2Props } from './AnalyticsModuleFT2.types';

const NULL_PLACEHOLDER = '—';

export default function AnalyticsModuleFT2(
  props: AnalyticsModuleFT2Props
) {
  const {
    context,
    systemStatus,
    stabilityIndicator,
    dataCoverage,
    trendSignal,
  } = props;

  // Instrumentation for observability & debugging
  // (Allowed in FT2: visibility ≠ interpretation)
  console.debug('[FT2][Analytics][Render]', props);

  return (
    <section>
      <h2>Analytics (FT2)</h2>

      <div>
        <strong>Period:</strong>{' '}
        {context.period.from} → {context.period.to}
      </div>

      <div>
        <strong>Signals observed:</strong>{' '}
        {context.signalsObserved ?? NULL_PLACEHOLDER}
      </div>

      <hr />

      <div>
        <strong>System status:</strong>{' '}
        {systemStatus
          ? `${systemStatus.state} (${systemStatus.reliability})`
          : NULL_PLACEHOLDER}
      </div>

      <div>
        <strong>Stability:</strong>{' '}
        {stabilityIndicator
          ? stabilityIndicator.state
          : NULL_PLACEHOLDER}
      </div>

      <div>
        <strong>Data coverage:</strong>
        {dataCoverage ? (
          <ul>
            {dataCoverage.map((c, i) => (
              <li key={i}>
                [{c.domain}] {c.status}
              </li>
            ))}
          </ul>
        ) : (
          ` ${NULL_PLACEHOLDER}`
        )}
      </div>

      <div>
        <strong>Trend:</strong>{' '}
        {trendSignal
          ? trendSignal.direction
          : NULL_PLACEHOLDER}
      </div>
    </section>
  );
}