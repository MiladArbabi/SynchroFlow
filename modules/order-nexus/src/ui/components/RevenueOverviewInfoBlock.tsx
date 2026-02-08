import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

// ⬇️ Epistemic contract (Phase A)
import type { EpistemicValue } from '@lasyncro/epistemic';

/**
 * RevenueOverviewInfoBlockProps
 * -----------------------------
 * Phase A migration:
 * - Revenue fields now carry epistemic metadata
 * - Visual behavior remains unchanged
 *
 * IMPORTANT:
 * - This component is NOT yet epistemically correct
 * - It still gates display on executionCoverage
 * - That behavior will be removed in later phases
 */
type RevenueOverviewInfoBlockProps = {
  revenue: {
    totalSales: EpistemicValue<number>;
    earned: EpistemicValue<number>;
    blocked: EpistemicValue<number>;
    pending: EpistemicValue<number>;

    // Legacy coverage signal (unchanged in Phase A)
    executionCoverage: 'sufficient' | 'insufficient';
  };
};

/**
 * Temporary formatter
 * -------------------
 * Phase A rule:
 * - Use raw `.value`
 * - Do not branch on epistemic state yet
 */
const fmtMoney = (v: number | null) =>
  v == null ? null : Number(v.toFixed(2));

export function RevenueOverviewInfoBlock({
  revenue,
}: RevenueOverviewInfoBlockProps) {
  return (
    <InfoBlock title="Revenue overview">
      <InfoBlockRow
        label="Total sales"
        value={fmtMoney(revenue.totalSales.value)}
      />

      <InfoBlockRow
        label="Earned revenue"
        value={
          revenue.executionCoverage === 'sufficient'
            ? fmtMoney(revenue.earned.value)
            : null
        }
      />

      <InfoBlockRow
        label="Pending revenue"
        value={
          revenue.executionCoverage === 'sufficient'
            ? fmtMoney(revenue.pending.value)
            : null
        }
      />

      <InfoBlockRow
        label="Blocked revenue"
        value={
          revenue.executionCoverage === 'sufficient'
            ? fmtMoney(revenue.blocked.value)
            : null
        }
      />

      <InfoBlockFooter
        line1="> VALUES SHOWN — CURRENT EXECUTION STATE"
        line2="> PAYMENT AND PROFIT NOT EVALUATED"
      />
    </InfoBlock>
  );
}
