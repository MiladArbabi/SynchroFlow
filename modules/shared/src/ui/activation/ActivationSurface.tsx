// modules/shared/src/ui/activation/ActivationSurface.tsx

import React from 'react';
import { ActivationSurfaceProps } from './types';

export const ActivationSurface: React.FC<ActivationSurfaceProps> = (props) => {
  const {
    identity,
    blindness,
    absenceProof,
    valueAfterActivation,
    primaryCTA,
    trust,
    postActivation,
  } = props;

  return (
    <section data-testid="activation-surface">
      {identity && <h1>{identity.title}</h1>}

      <div data-testid="activation-blindness">
        {blindness.subject} — {blindness.dimension} ({blindness.status})
      </div>

      {absenceProof && (
        <div data-testid="activation-absence">
          {absenceProof.riskStatement}
        </div>
      )}

      {valueAfterActivation && (
        <div data-testid="activation-value">
          {valueAfterActivation.outcome}
        </div>
      )}

      <div data-testid="activation-cta">
        <button>{primaryCTA.label}</button>
      </div>

      <div data-testid="activation-trust">
        {trust.bullets.map((line, idx) => (
          <div key={idx}>{line}</div>
        ))}
      </div>

      {postActivation && (
        <div data-testid="activation-post">
          {postActivation.reflection}
        </div>
      )}
    </section>
  );
};
