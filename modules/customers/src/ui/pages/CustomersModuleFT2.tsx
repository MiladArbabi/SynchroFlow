// modules/customers/src/ui/pages/CustomersModuleFT2.tsx

export interface CustomersModuleFT2Props {
  context: {
    period: {
      from: string;
      to: string;
    };
    customersAnalyzed: number | null;
  };

  valueSummary: {
    activeCustomers: number | null;
    repeatRatePct: number | null;
    avgOrderValue: number | null;
    lifetimeValue: number | null;
    currency: string | null;
  };

  qualitySignal: {
    type:
      | 'low_repeat'
      | 'low_value'
      | 'high_churn'
      | 'concentration'
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

export default function CustomersModuleFT2(
  props: CustomersModuleFT2Props
) {
  const {
    context,
    valueSummary,
    qualitySignal,
    timeSignal,
  } = props;

  console.debug(
    '[FT2][Customers][CustomersModuleFT2] props',
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
          <strong>Customers analyzed</strong>:{' '}
          {context.customersAnalyzed === null
            ? '—'
            : context.customersAnalyzed}
        </div>
      </section>

      {/* Value Summary */}
      <section>
        <div>
          <strong>Active customers</strong>:{' '}
          {valueSummary.activeCustomers === null
            ? '—'
            : valueSummary.activeCustomers}
        </div>
        <div>
          <strong>Repeat rate</strong>:{' '}
          {valueSummary.repeatRatePct === null
            ? '—'
            : `${valueSummary.repeatRatePct}%`}
        </div>
        <div>
          <strong>Average order value</strong>:{' '}
          {valueSummary.avgOrderValue === null
            ? '—'
            : `${valueSummary.avgOrderValue} ${
                valueSummary.currency ?? ''
              }`}
        </div>
        <div>
          <strong>Lifetime value</strong>:{' '}
          {valueSummary.lifetimeValue === null
            ? '—'
            : `${valueSummary.lifetimeValue} ${
                valueSummary.currency ?? ''
              }`}
        </div>
      </section>

      {/* Quality Signal */}
      <section>
        <strong>Dominant customer weakness</strong>:{' '}
        {qualitySignal === null
          ? '—'
          : `${qualitySignal.type} · ${qualitySignal.confidence}`}
      </section>

      {/* Time Signal */}
      <section>
        <strong>Trend</strong>:{' '}
        {timeSignal === null ? '—' : timeSignal.trend}
      </section>
    </section>
  );
}