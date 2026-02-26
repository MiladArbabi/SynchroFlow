import * as React from 'react';

/**
 * DecisionLayout
 * --------------
 * Container for decision layer.
 * Must never render FT2 primitives.
 */
export const DecisionLayout: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return <section data-layer="decision">{children}</section>;
};