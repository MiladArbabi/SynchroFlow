import { FT2EmptyState } from './FT2EmptyState';

export type FT2RatioProps = {
  numerator: number | null;
  denominator: number | null;
  label?: string;
};

export function FT2Ratio({
  numerator,
  denominator,
  label,
}: FT2RatioProps) {
  if (numerator === null && denominator === null) {
    return <FT2EmptyState />;
  }

  return (
    <div data-ft2-ratio>
      {label && (
        <div data-ft2-ratio-label>
          {label}
        </div>
      )}

      <div data-ft2-ratio-values>
        {numerator !== null && (
          <div data-ft2-ratio-numerator>
            {numerator}
          </div>
        )}

        {denominator !== null && (
          <div data-ft2-ratio-denominator>
            {denominator}
          </div>
        )}
      </div>
    </div>
  );
}
