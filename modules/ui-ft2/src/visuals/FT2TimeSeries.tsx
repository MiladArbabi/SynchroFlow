export type FT2TimeSeriesPoint = {
  x: string;
  y: number | null;
};

export type FT2TimeSeriesProps = {
  points: FT2TimeSeriesPoint[] | null;
};

export function FT2TimeSeries({ points }: FT2TimeSeriesProps) {
  if (!points || points.length === 0) {
    return (
      <div
        data-ft2-timeseries
        data-testid="ft2-timeseries-empty"
      />
    );
  }

  return (
    <div
      data-ft2-timeseries
      data-testid="ft2-timeseries-frame"
    >
      {points.map((point, index) => (
        <div
          key={index}
          data-ft2-timeseries-point
        >
          {point.y ?? '—'}
        </div>
      ))}
    </div>
  );
}
