import {
  PanelRow,
  PanelFooter
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
    <>

      <PanelRow
        label="Returned units"
        value={returnedUnits}
      />

      <PanelRow
        label="Orders affected"
        value={affectedOrders}
      />

      <PanelFooter
        line1="> POST-FULFILLMENT REGRESSION"
        line2="> DOES NOT BLOCK EXECUTION"
      />
    </>
  );
}