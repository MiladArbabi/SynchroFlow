/**
 * ⚠️ FT2 UI COMPONENT
 * ------------------
 * Read-only.
 * Aggregate-only.
 *
 * This component MUST NOT:
 * - render attribution
 * - imply causes
 * - suggest actions
 */

import {
  PanelRow,
  PanelFooter,
} from '@lasyncro/ui-ft2';

type ObligationOverviewInfoBlockProps = {
  obligations: {
    coverage: {
      status: 'sufficient' | 'insufficient';
    };
  };
};

/**
 * Obligation Overview — FT2
 * -------------------------
 * Read-only visibility into constrained value.
 *
 * No actions.
 * No prioritization.
 * No guidance.
 */
export function ObligationOverviewInfoBlock({
  obligations,
}: ObligationOverviewInfoBlockProps) {

  return (
    <>
      <PanelRow
        label="Constraint signals"
        value={
          obligations.coverage.status === 'sufficient'
            ? 'Present'
            : 'Insufficient data'
        }
      />

      <PanelFooter
        line1="> ORDERS MAY BE CONSTRAINED BY EXPLICIT CONDITIONS"
        line2="> INVENTORY, CUSTOMER, OR OPERATIONAL"
      />
    </>
  );
}