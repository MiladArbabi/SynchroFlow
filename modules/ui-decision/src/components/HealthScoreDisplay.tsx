import * as React from 'react';

/**
 * HealthScoreDisplay
 * ------------------
 * Deterministic numeric representation.
 * No emotional styling.
 * Numeric only + accessible label.
 */
export const HealthScoreDisplay: React.FC<{
  score: number;
}> = ({ score }) => {
  return (
    <div
      aria-label={`Health score ${score} out of 100`}
      data-health-score
      style={{
        fontWeight: 600,
        fontSize: 14,
        minWidth: 40,
        textAlign: 'right',
      }}
    >
      {score}
    </div>
  );
};