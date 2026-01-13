// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx

/**
 * OrdersModuleFT2
 * ----------------
 * FT2 observability surface for OrderNexus.
 *
 * PURPOSE
 * -------
 * This component renders the *first governed truth window* into
 * order performance.
 *
 * It is intentionally:
 * - Read-only
 * - Deterministic
 * - Boring
 * - Non-explanatory
 *
 * This UI must NEVER:
 * - Explain why something happened
 * - Suggest actions
 * - Compute or derive values
 * - Hide missing data behind fake completeness
 *
 * Mental model:
 * This is a window, not a brain.
 */

export interface OrdersModuleFT2Props {
  context: {
    period: {
      from: string;
      to: string;
    };
    ordersObserved: number | null;
  };

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoverage: {
    completenessPct: number | null;
  };
}

export default function OrdersModuleFT2(props: OrdersModuleFT2Props) {
  const {
    context,
    totals,
    outcome,
    trend,
    dataCoverage,
  } = props;

  console.debug('[FT2][OrderNexus][OrdersModuleFT2] props', props);

  return (
    <section data-testid="orders-ft2-root">
      {/* ───────── Snapshot ───────── */}
      <section>
        <div>
          <strong>Period</strong>: {context.period.from} → {context.period.to}
        </div>

        <div>
          <strong>Orders observed</strong>:{' '}
          {context.ordersObserved === null ? '—' : context.ordersObserved}
        </div>

        <div>
          <strong>Total revenue</strong>:{' '}
          {totals.revenueTotal === null
            ? '—'
            : `${totals.revenueTotal} ${totals.currency ?? ''}`}
        </div>

        <div>
          <strong>Total cost</strong>:{' '}
          {totals.costTotal === null
            ? '—'
            : `${totals.costTotal} ${totals.currency ?? ''}`}
        </div>

        <div>
          <strong>Net outcome</strong>: {outcome ? outcome.status : '—'}
        </div>

        <div>
          <strong>Trend</strong>: {trend ? trend.direction : '—'}
        </div>

        <div>
          <strong>Data coverage</strong>:{' '}
          {dataCoverage.completenessPct === null
            ? '—'
            : `${dataCoverage.completenessPct}%`}
        </div>
      </section>

      <hr />

      {/* ───────── Timeseries ───────── */}
      <section>
        <h4>Order activity over time</h4>
        {/* OrdersTimeseriesWidget already wired here */}
      </section>

      <hr />

      {/* ───────── Distribution ───────── */}
      <section>
        <h4>Order value distribution</h4>
        {/* OrdersDistributionWidget already wired here */}
      </section>
    </section>
  );
}