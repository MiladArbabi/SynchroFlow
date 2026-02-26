import * as React from 'react';
import { PriorityStackItem } from './PriorityStackItem.js';

/**
 * PriorityStack
 * -------------
 * Semantic ordered list.
 * Ordering MUST match backend.
 * No client-side sorting allowed.
 */
export const PriorityStack: React.FC<{
  items: {
    order_id: string;
    order_health_score: number;
  }[];
}> = ({ items }) => {
  return (
    <ol
      aria-label="Prioritized orders by health score"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {items.map((item, index) => (
        <PriorityStackItem
          key={item.order_id}
          index={index}
          orderId={item.order_id}
          score={item.order_health_score}
        />
      ))}
    </ol>
  );
};