import { InfoBlock, InfoBlockRow, InfoBlockFooter } from '@lasyncro/ui-ft2';

/**
 * OrdersPriorityStackSection
 * --------------------------
 * Pure render component.
 *
 * CONTRACT:
 * - Receives backend-ordered priority items.
 * - No client-side sorting.
 * - No data fetching.
 */
export interface OrdersPriorityStackSectionProps {
  items: {
    order_id: string;
    order_health_score: number;
  }[];
}

export function OrdersPriorityStackSection({
  items,
}: OrdersPriorityStackSectionProps) {
  if (!items || items.length === 0) return null;

  return (
    <InfoBlock title="Priority stack">

      {items.length === 0 ? (
        <InfoBlockRow
          label="No prioritized orders"
          value="—"
        />
      ) : (
        items.map((item) => (
          <InfoBlockRow
            key={item.order_id}
            label={`Order ${item.order_id}`}
            value={item.order_health_score}
          />
        ))
      )}

      <InfoBlockFooter
        line1="> RANKING FROM RISK SNAPSHOT"
        line2="> NO CLIENT-SIDE SORTING"
      />
    </InfoBlock>
  );
}