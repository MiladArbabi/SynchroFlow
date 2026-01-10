// modules/finances/src/ui/pages/FinancesModuleFT2.tsx

export interface FinancesModuleFT2Props {
  context: {
    period:
     | {
         from: string;
         to: string;
       }
     | null;
    revenueObserved: number | null;
    netObserved: number | null;
  };

  outcome:
    | {
        status: 'positive' | 'negative' | 'unknown';
      }
    | null;

  trend:
    | {
        direction: 'up' | 'down' | 'flat' | 'unknown';
      }
    | null;

  dataCoverage:
    | {
        completenessPct: number | null;
      }
    | null;
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
  const { context, outcome, trend, dataCoverage } = props;

  console.warn('[MOUNT] FinancesModuleFT2');

  return (
    <section data-testid="finances-ft2-root">
      {/* Context */}
      <section>
        <div>
          <strong>Period</strong>:{' '}
          {context.period === null
            ? '—'
            : `${context.period.from} → ${context.period.to}`}
        </div>

        <div>
          <strong>Revenue observed</strong>:{' '}
          {context.revenueObserved === null ? '—' : context.revenueObserved}
        </div>

        <div>
          <strong>Net observed</strong>:{' '}
          {context.netObserved === null ? '—' : context.netObserved}
        </div>
      </section>

      {/* Outcome */}
      <section>
        <strong>Outcome</strong>:{' '}
        {outcome === null ? '—' : outcome.status}
      </section>

      {/* Trend */}
      <section>
        <strong>Trend</strong>:{' '}
        {trend === null ? '—' : trend.direction}
      </section>

      {/* Data Coverage */}
      <section>
        <strong>Data coverage</strong>:{' '}
        {dataCoverage?.completenessPct === null ||
        dataCoverage === null
          ? '—'
          : `${dataCoverage.completenessPct}%`}
      </section>
    </section>
  );
}