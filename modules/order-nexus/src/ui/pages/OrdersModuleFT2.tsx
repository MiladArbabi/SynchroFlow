// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx

export interface OrdersModuleFT2Props {
  context: {
    period: {
      from: string;
      to: string;
    };
    ordersAnalyzed: number | null;
  };

  marginSummary: {
    avgMarginPct: number | null;
    lossRatePct: number | null;
    totalLossAmount: number | null;
    currency: string | null;
  };

  lossDrivers: Array<{
    type:
      | 'shipping'
      | 'product_cost'
      | 'fees'
      | 'discount'
      | 'refund'
      | 'overhead'
      | 'unknown';
    contributionPct: number | null;
    confidence: 'high' | 'medium' | 'low';
  }> | null;

  patterns: Array<{
    description: string;
    affectedOrdersPct: number | null;
    estimatedImpact: number | null;
    currency: string | null;
  }> | null;

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

export default function OrdersModuleFT2(props: OrdersModuleFT2Props) {
  const {
    context,
    marginSummary,
    lossDrivers,
    patterns,
    timeSignal,
  } = props;

  console.debug('[FT2][OrderNexus][OrdersModuleFT2] props', props);

  return (
    <section data-testid="orders-ft2-root">
      {/* Context */}
      <section>
        <div>
          <strong>Period</strong>: {context.period.from} → {context.period.to}
        </div>
        <div>
          <strong>Orders analyzed</strong>:{' '}
          {context.ordersAnalyzed === null ? '—' : context.ordersAnalyzed}
        </div>
      </section>

      {/* Margin Summary */}
      <section>
        <div>
          <strong>Average margin</strong>:{' '}
          {marginSummary.avgMarginPct === null
            ? '—'
            : `${marginSummary.avgMarginPct}%`}
        </div>
        <div>
          <strong>Loss rate</strong>:{' '}
          {marginSummary.lossRatePct === null
            ? '—'
            : `${marginSummary.lossRatePct}%`}
        </div>
        <div>
          <strong>Total loss</strong>:{' '}
          {marginSummary.totalLossAmount === null
            ? '—'
            : `${marginSummary.totalLossAmount} ${marginSummary.currency ?? ''}`}
        </div>
      </section>

      {/* Loss Drivers */}
      <section>
        <strong>Dominant loss drivers</strong>
        {lossDrivers === null || lossDrivers.length === 0 ? (
          <div>—</div>
        ) : (
          <ul>
            {lossDrivers.map((driver, idx) => (
              <li key={idx}>
                {driver.type} ·{' '}
                {driver.contributionPct === null
                  ? '—'
                  : `${driver.contributionPct}%`}{' '}
                · {driver.confidence}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Patterns */}
      <section>
        <strong>Repeated patterns</strong>
        {patterns === null || patterns.length === 0 ? (
          <div>—</div>
        ) : (
          <ul>
            {patterns.map((pattern, idx) => (
              <li key={idx}>
                {pattern.description} ·{' '}
                {pattern.affectedOrdersPct === null
                  ? '—'
                  : `${pattern.affectedOrdersPct}% orders`} ·{' '}
                {pattern.estimatedImpact === null
                  ? '—'
                  : `${pattern.estimatedImpact} ${pattern.currency ?? ''}`}
              </li>
            ))}
          </ul>
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