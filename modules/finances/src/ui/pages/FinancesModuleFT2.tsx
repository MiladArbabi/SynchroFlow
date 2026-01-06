// modules/finances/src/ui/pages/FinancesModuleFT2.tsx

export interface FinancesModuleFT2Props {
  context: {
    period: {
      from: string;
      to: string;
    };
    transactionsAnalyzed: number | null;
  };

  costSummary: {
    totalRevenue: number | null;
    totalCost: number | null;
    netResult: number | null;
    currency: string | null;
  };

  costBreakdown: Array<{
    type:
      | 'cogs'
      | 'fulfillment'
      | 'fees'
      | 'overhead'
      | 'refunds'
      | 'other';
    amount: number | null;
    pctOfRevenue: number | null;
  }> | null;

  dominantPressure: {
    type:
      | 'cogs'
      | 'fulfillment'
      | 'fees'
      | 'overhead'
      | 'refunds'
      | 'unknown';
    confidence: 'high' | 'medium' | 'low';
  } | null;

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

export default function FinancesModuleFT2(
  props: FinancesModuleFT2Props
) {
  const {
    context,
    costSummary,
    costBreakdown,
    dominantPressure,
    timeSignal,
  } = props;

  console.debug('[FT2][Finances][FinancesModuleFT2] props', props);

  return (
    <section data-testid="finances-ft2-root">
      {/* Context */}
      <section>
        <div>
          <strong>Period</strong>: {context.period.from} →{' '}
          {context.period.to}
        </div>
        <div>
          <strong>Transactions analyzed</strong>:{' '}
          {context.transactionsAnalyzed === null
            ? '—'
            : context.transactionsAnalyzed}
        </div>
      </section>

      {/* Cost Summary */}
      <section>
        <div>
          <strong>Total revenue</strong>:{' '}
          {costSummary.totalRevenue === null
            ? '—'
            : `${costSummary.totalRevenue} ${
                costSummary.currency ?? ''
              }`}
        </div>
        <div>
          <strong>Total cost</strong>:{' '}
          {costSummary.totalCost === null
            ? '—'
            : `${costSummary.totalCost} ${
                costSummary.currency ?? ''
              }`}
        </div>
        <div>
          <strong>Net result</strong>:{' '}
          {costSummary.netResult === null
            ? '—'
            : `${costSummary.netResult} ${
                costSummary.currency ?? ''
              }`}
        </div>
      </section>

      {/* Cost Breakdown */}
      <section>
        <strong>Cost breakdown</strong>
        {costBreakdown === null || costBreakdown.length === 0 ? (
          <div>—</div>
        ) : (
          <ul>
            {costBreakdown.map((row, idx) => (
              <li key={idx}>
                {row.type} ·{' '}
                {row.amount === null ? '—' : row.amount} ·{' '}
                {row.pctOfRevenue === null
                  ? '—'
                  : `${row.pctOfRevenue}%`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dominant Pressure */}
      <section>
        <strong>Dominant cost pressure</strong>:{' '}
        {dominantPressure === null
          ? '—'
          : `${dominantPressure.type} · ${dominantPressure.confidence}`}
      </section>

      {/* Time Signal */}
      <section>
        <strong>Trend</strong>:{' '}
        {timeSignal === null ? '—' : timeSignal.trend}
      </section>
    </section>
  );
}
