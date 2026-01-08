/**
 * AnalyticsModuleFT2
 * ==================
 *
 * FT2 observability surface for Analytics.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * This component renders the highest read-only truth surface for Analytics.
 *
 * It answers ONE question only:
 *   → “What analytics data exists, and how is it moving?”
 *
 * It is intentionally:
 * - Read-only
 * - Deterministic
 * - Underpowered
 * - Non-explanatory
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 * - ❌ NOT system health analysis
 * - ❌ NOT stability interpretation
 * - ❌ NOT data quality reasoning
 * - ❌ NOT recommendations or actions
 *
 * All “why”, “so what”, and prioritization belongs to SKU-OS+ layers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNERSHIP & BOUNDARIES
 * ─────────────────────────────────────────────────────────────────────────────
 * - Backend: decides meaning (Facts → Intelligence → FTEP)
 * - Adapter: dumb pipe (undefined → null only)
 * - This component: renders values, nothing more
 *
 * If this component ever feels “helpful” or “smart”,
 * the FT2 contract has been violated.
 */

import React from 'react';
import type { AnalyticsModuleFT2Props } from './AnalyticsModuleFT2.types';

const NULL_PLACEHOLDER = '—';

/**
 * AnalyticsModuleFT2
 * -----------------
 * Canonical FT2 UI for Analytics.
 *
 * Design rules (NON-NEGOTIABLE):
 * - All props are mandatory at the top level
 * - Uncertainty is expressed as `null`
 * - All `null` values render as "—"
 * - No inference, no computation, no explanation
 */
export default function AnalyticsModuleFT2(
  props: AnalyticsModuleFT2Props
) {
  const { context, outcome, trend } = props;

  // FT2 instrumentation only (visibility ≠ interpretation)
  console.debug('[FT2][Analytics][AnalyticsModuleFT2] props', props);

  return (
    <section data-testid="analytics-ft2-root">
      {/* ───────────────── Context ───────────────── */}
      <section>
        <div>
          <strong>Period</strong>: {context.period.from} →{' '}
          {context.period.to}
        </div>
      </section>

      {/* ───────────────── Outcome ───────────────── */}
      <section>
        <strong>Outcome</strong>:{' '}
        {outcome === null ? NULL_PLACEHOLDER : outcome.status}
      </section>

      {/* ───────────────── Trend ───────────────── */}
      <section>
        <strong>Trend</strong>:{' '}
        {trend === null ? NULL_PLACEHOLDER : trend.direction}
      </section>
    </section>
  );
}