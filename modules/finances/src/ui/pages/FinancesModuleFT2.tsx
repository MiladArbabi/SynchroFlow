// modules/finances/src/ui/pages/FinancesModuleFT2.tsx

export interface FinancesModuleFT2Props {
  context: {
    period: {
      from: string;
      to: string;
    };
    transactionsObserved: number | null;
  };

  costModelState: {
    hasActiveModel: boolean | null;
    updatedAt: string | null;
    currency: string | null;
  } | null;

  timeSignal: {
    trend: 'improving' | 'stable' | 'deteriorating' | 'unknown';
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
}

/**
 * FinancesModuleFT2
 * -----------------
 * FT2 is a read-only observability snapshot.
 *
 * Rules enforced here:
 * - No inference
 * - No business meaning
 * - No conditional hiding (except null)
 * - Explicit placeholders for unknown data
 *
 * If this UI ever feels “smart”, it is a bug.
 */
export default function FinancesModuleFT2(
  props: FinancesModuleFT2Props
) {
  const { context, costModelState, timeSignal } = props;

  return (
    <section data-testid="finances-ft2-root">
      {/* Context */}
      <section>
        <div>
          <strong>Period</strong>: {context.period.from} →{' '}
          {context.period.to}
        </div>
        <div>
          <strong>Transactions observed</strong>:{' '}
          {context.transactionsObserved === null
            ? '—'
            : context.transactionsObserved}
        </div>
      </section>

      {/* Cost Model Status */}
      <section>
        <strong>Cost model status</strong>
        {costModelState === null ? (
          <div>—</div>
        ) : (
          <>
            <div>
              <strong>Active model</strong>:{' '}
              {costModelState.hasActiveModel === null
                ? '—'
                : costModelState.hasActiveModel
                ? 'yes'
                : 'no'}
            </div>
            <div>
              <strong>Last updated</strong>:{' '}
              {costModelState.updatedAt ?? '—'}
            </div>
            <div>
              <strong>Currency</strong>:{' '}
              {costModelState.currency ?? '—'}
            </div>
          </>
        )}
      </section>

      {/* Time Signal */}
      <section>
        <strong>Trend</strong>:{' '}
        {timeSignal === null ? '—' : timeSignal.trend}
      </section>
    </section>
  );
}