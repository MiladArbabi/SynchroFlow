import { FT2EmptyState } from './FT2EmptyState.js';

export type FT2DistributionProps = {
  buckets: Array<{
    key: string;
    value: number | null;
  }> | null;
};

export function FT2Distribution({ buckets }: FT2DistributionProps) {
  if (buckets === null) {
    return <FT2EmptyState />;
  }

  return (
    <div data-ft2-distribution data-testid="ft2-distribution-frame">
      {buckets.map((bucket) => (
        <div
          key={bucket.key}
          data-ft2-distribution-bucket
        >
          <div
            data-testid="ft2-distribution-bucket-label"
            data-ft2-distribution-bucket-label
          >
            {bucket.key}
          </div>

          {bucket.value !== null && (
            <div
              data-testid="ft2-distribution-bucket-value"
              data-ft2-distribution-bucket-value
            >
              {bucket.value}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}