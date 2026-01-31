import {
  InfoBlock,
  InfoBlockRow,
  InfoBlockFooter,
} from '@lasyncro/ui-ft2';

type ObligationOverviewInfoBlockProps = {
  obligations: {
    totalBlockedValue: number | null;

    blockedBy: {
      inventory: number | null;
      customer: number | null;
      operational: number | null;
      other: number | null;
    } | null;

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
        label="Total blocked value"
        value={obligations.totalBlockedValue}
      />
      <InfoBlockRow
        label="Blocked — inventory"
        value={obligations.blockedBy?.inventory ?? null}
      />
      <InfoBlockRow
        label="Blocked — customer"
        value={obligations.blockedBy?.customer ?? null}
      />
      <InfoBlockRow
        label="Blocked — operational"
        value={obligations.blockedBy?.operational ?? null}
      />
      <InfoBlockRow
        label="Blocked — other"
        value={obligations.blockedBy?.other ?? null}
      />
      <InfoBlockFooter
        line1="> VALUE SHOWN IS CURRENTLY CONSTRAINED"
        line2="> NO ACTIONS OR OUTCOMES ARE IMPLIED"
      />
    </InfoBlock>
  );
}