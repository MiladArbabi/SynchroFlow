import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type RevenueOverviewInfoBlockProps = {
  revenue: {
    totalSales: number | null;
    earned: number | null;
    pending: number | null;
    executionCoverage: 'sufficient' | 'insufficient';
  };
};

const fmtMoney = (v: number | null) =>
  v == null ? null : Number(v.toFixed(2));

export function RevenueOverviewInfoBlock({
  revenue,
}: RevenueOverviewInfoBlockProps) {
  return (
    <InfoBlock title="Revenue overview">
      <InfoBlockRow
        label="Total sales"
        value={fmtMoney(revenue.totalSales)}
      />

      <InfoBlockRow
        label="Earned revenue"
        value={
          revenue.executionCoverage === 'sufficient'
            ? fmtMoney(revenue.earned)
            : null
        }
      />

      <InfoBlockRow
        label="Pending revenue"
        value={
          revenue.executionCoverage === 'sufficient'
            ? fmtMoney(revenue.pending)
            : null
        }
      />

      <InfoBlockFooter
        line1="> SALES VALUE SHOWN — EXECUTION AVAILABILITY ONLY"
        line2="> PAYMENT AND PROFIT NOT EVALUATED"
      />
    </InfoBlock>
  );
}