// modules/customers/src/ui/pages/CustomersModuleFT2.tsx

/**
 * CustomersModuleFT2
 * ------------------
 * FT2 Customers is an **observability-only UI surface**.
 *
 * IMPORTANT:
 * - This module does NOT perform customer intelligence.
 * - It does NOT infer behavior, value, churn, or intent.
 * - All semantics originate from backend engines (Specter).
 *
 * Why this exists:
 * - Provide a stable, honest UI for session-level visibility
 * - Avoid semantic drift between "customers" and "specter"
 * - Prevent frontend from inventing meaning ahead of backend truth
 *
 * Architectural rule:
 * Customers FT2 = "What the system currently observes"
 * NOT "What the customer means"
 */

export interface CustomersModuleFT2Props {
  context: {
    period: {
      from: string;
      to: string;
    };

    /**
     * Number of anonymous sessions observed in the period.
     * This is a factual count, not a customer metric.
     */
    sessionsObserved: number | null;
  };

  /**
   * High-level health of the customer-observability subsystem.
   * Derived upstream (typically Specter).
   */
  systemState: {
    status: 'healthy' | 'degraded' | 'partial' | 'unknown';
    confidence: 'high' | 'medium' | 'low';

    /**
     * Optional human-readable explanation
     * (e.g. partial ingestion, low data volume).
     */
    reason?: string;
  } | null;

  /**
   * Time-based trend indicator.
   * Must be computed upstream.
   */
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

export default function CustomersModuleFT2(
  props: CustomersModuleFT2Props
) {
  const { context, systemState, timeSignal } = props;

  /**
   * Debug logging intentionally kept:
   * - Helps validate contract shape during evolution
   * - Ensures no accidental inference sneaks in
   */
  console.debug(
    '[FT2][Customers][Observability] props',
    props
  );

  return (
    <section data-testid="customers-ft2-root">
      {/* Context */}
      <section>
        <div>
          <strong>Period</strong>: {context.period.from} →{' '}
          {context.period.to}
        </div>
        <div>
          <strong>Sessions observed</strong>:{' '}
          {context.sessionsObserved === null
            ? '—'
            : context.sessionsObserved}
        </div>
      </section>

      {/* System State */}
      <section>
        <strong>System state</strong>:{' '}
        {systemState === null
          ? '—'
          : `${systemState.status} · ${systemState.confidence}`}
      </section>

      {/* Trend */}
      <section>
        <strong>Trend</strong>:{' '}
        {timeSignal === null ? '—' : timeSignal.trend}
      </section>
    </section>
  );
}