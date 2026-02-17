import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

import { EpistemicInfoBlockRow } from '@lasyncro/ui-ft2';
import type { EpistemicValue } from '@lasyncro/epistemic';
import { renderEpistemicMoney } from './renderEpistemicMoney.js';

/**
 * RevenueOverviewInfoBlockProps
 * -----------------------------
 * Phase B2:
 * - executionCoverage REMOVED
 * - Epistemic state is the single authority
 * - Component performs NO conditional logic
 */
type RevenueOverviewInfoBlockProps = {
  revenue: {
    totalSales: EpistemicValue<number>;
    earned: EpistemicValue<number>;
    blocked: EpistemicValue<number>;
    pending: EpistemicValue<number>;
  };
};

export function RevenueOverviewInfoBlock({
  revenue,
}: RevenueOverviewInfoBlockProps) {

  return (
    <InfoBlock title="Revenue overview">
      <EpistemicInfoBlockRow
        label="Total sales"
        signal={renderEpistemicMoney(revenue.totalSales)}
      />

      <EpistemicInfoBlockRow
        label="Earned revenue"
        signal={renderEpistemicMoney(revenue.earned)}
      />

      <EpistemicInfoBlockRow
        label="Pending revenue"
        signal={renderEpistemicMoney(revenue.pending)}
      />

      <EpistemicInfoBlockRow
        label="Blocked revenue"
        signal={renderEpistemicMoney(revenue.blocked)}
      />
      <InfoBlockFooter
        line1="> VALUES SHOWN — EPISTEMIC STATE"
        line2="> PAYMENT AND PROFIT NOT EVALUATED"
      />
    </InfoBlock>
  );
}