import React from 'react';
import { ActivationSurfaceProps } from './types';

export const ActivationSurface: React.FC<ActivationSurfaceProps> = ({
  identity,
  blindness,
  absenceProof,
  valueAfterActivation,
  primaryCTA,
  trust,
  postActivation,
  onAction,
}) => {
  return (
    <section data-testid="activation-surface">
      {identity && <h1>{identity.title}</h1>}

      <div>
        {blindness.subject} — {blindness.dimension} ({blindness.status})
      </div>

      {absenceProof && <div>{absenceProof.riskStatement}</div>}
      {valueAfterActivation && <div>{valueAfterActivation.outcome}</div>}

      <button
        onClick={() => onAction?.(primaryCTA.actionId)}
      >
        {primaryCTA.label}
      </button>

      <div>
        {trust.bullets.map((line, idx) => (
          <div key={idx}>{line}</div>
        ))}
      </div>

      {postActivation && <div>{postActivation.reflection}</div>}
    </section>
  );
};
