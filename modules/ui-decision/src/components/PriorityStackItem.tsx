import * as React from 'react';
import { HealthScoreDisplay } from './HealthScoreDisplay.js';

/**
 * PriorityStackItem
 * -----------------
 * One ranked order.
 * Must not alter backend ordering.
 */
export const PriorityStackItem: React.FC<{
  index: number;
  orderId: string;
  score: number;
  children?: React.ReactNode;
}> = ({ index, orderId, score, children }) => {
  return (
    <li
      aria-posinset={index + 1}
      data-priority-item
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle, #E0E0E0)',
      }}
    >
      <div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-secondary, #666)',
          }}
        >
          Order
        </div>

        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {orderId}
        </div>

        {children}
      </div>

      <HealthScoreDisplay score={score} />
    </li>
  );
};