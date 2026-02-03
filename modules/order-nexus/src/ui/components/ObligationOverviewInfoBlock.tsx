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
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type ObligationOverviewInfoBlockProps = {
  obligations: {
    /**
     * FT2 Obligations (Aggregate Only)
     */
    totalBlockedValue: number | null;

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
    <InfoBlock title="Obligation overview">
      <InfoBlockRow
        label="Blocked value"
        value={obligations.totalBlockedValue ?? null}
      />
      <InfoBlockFooter
        line1="> BLOCKED VALUE SHOWN — LIFETIME STATE"
        line2="> NOT AFFECTED BY DATE RANGE SELECTION"
      />
    </InfoBlock>
  );
}