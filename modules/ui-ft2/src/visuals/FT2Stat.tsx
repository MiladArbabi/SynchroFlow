import { FT2EmptyState } from './FT2EmptyState';

export type FT2StatProps = {
  value: number | string | null;
  label?: string;
};

export function FT2Stat({ value, label }: FT2StatProps) {
  if (value === null) {
    return <FT2EmptyState />;
  }

  return (
    <div
      data-ft2-stat-value
      style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {value}
    </div>
  );
}