import * as React from 'react';

/**
 * DecisionSurface
 * ----------------
 * Distinct visual grammar from FT2.
 */
export const DecisionSurface: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return <div data-surface="decision">{children}</div>;
};