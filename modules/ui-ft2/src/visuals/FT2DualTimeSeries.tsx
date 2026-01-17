import { FT2EmptyState } from './FT2EmptyState';

export type FT2DualTimeSeriesProps = {
  left: Array<{ date: string; value: number | null }> | null;
  right: Array<{ date: string; value: number | null }> | null;
};

export function FT2DualTimeSeries({
  left,
  right,
}: FT2DualTimeSeriesProps) {
  if (left === null && right === null) {
    return <FT2EmptyState />;
  }

  const leftSeries = left ?? [];
  const rightSeries = right ?? [];

  // Build a shared, ordered date index (no inference)
  const dates = Array.from(
    new Set([
      ...leftSeries.map(p => p.date),
      ...rightSeries.map(p => p.date),
    ])
  ).sort();

  return (
    <div
      data-ft2-dual-timeseries
      data-testid="ft2-dual-timeseries-frame"
    >
      {dates.map((date) => {
        const leftPoint = leftSeries.find(p => p.date === date);
        const rightPoint = rightSeries.find(p => p.date === date);

        return (
          <div
            key={date}
            data-testid="ft2-dual-timeseries-row"
            data-ft2-dual-timeseries-row
          >
            <span data-ft2-dual-timeseries-date>{date}</span>

            {leftPoint?.value !== null && leftPoint?.value !== undefined && (
              <span
                data-testid="ft2-dual-timeseries-left-value"
                data-ft2-dual-timeseries-left-value
              >
                {leftPoint.value}
              </span>
            )}

            {rightPoint?.value !== null && rightPoint?.value !== undefined && (
              <span
                data-testid="ft2-dual-timeseries-right-value"
                data-ft2-dual-timeseries-right-value
              >
                {rightPoint.value}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}