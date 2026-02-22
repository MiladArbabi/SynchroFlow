import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
  EpistemicInfoBlockRow,
} from '@lasyncro/ui-ft2';

import type { EpistemicValue } from '@lasyncro/epistemic';
import { renderEpistemicMoney } from './renderEpistemicMoney.js';

type ReturnsOverviewInfoBlockProps = {
  returnedRevenue: EpistemicValue<number>;
  returnedUnits: number | null;
  affectedOrders: number | null;
};

export function ReturnsOverviewInfoBlock({
  returnedRevenue,
  returnedUnits,
  affectedOrders,
}: ReturnsOverviewInfoBlockProps) {
  return (
    <InfoBlock title="Returns overview">

      <EpistemicInfoBlockRow
        label="Returned revenue"
        signal={renderEpistemicMoney(returnedRevenue)}
      />

      <InfoBlockRow
        label="Returned units"
        value={returnedUnits}
      />

      <InfoBlockRow
        label="Orders affected"
        value={affectedOrders}
      />

      <InfoBlockFooter
        line1="> POST-FULFILLMENT REGRESSION"
        line2="> DOES NOT BLOCK EXECUTION"
      />
    </InfoBlock>
  );
}