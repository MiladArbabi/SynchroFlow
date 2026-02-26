import * as React from 'react';

/**
 * DecisionRow
 * -----------
 * Row grouping for urgency blocks.
 */
export const DecisionRow: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return <div data-row="decision">{children}</div>;
};