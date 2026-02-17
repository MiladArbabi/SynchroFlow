import React from 'react';
import { ActivationSurfaceProps } from './types.js';

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

      {blindness && (
        <div>
          {blindness.subject} — {blindness.dimension} ({blindness.status})
        </div>
      )}

      {absenceProof && <div>{absenceProof.riskStatement}</div>}
      {valueAfterActivation && <div>{valueAfterActivation.outcome}</div>}

     {primaryCTA && (
        <button
          onClick={() => {
            console.log('[ActivationSurface] CTA clicked', {
              actionId: primaryCTA.actionId,
              hasOnAction: Boolean(onAction),
            });
            onAction?.(primaryCTA.actionId);
          }}
        >
          {primaryCTA.label}
        </button>
      )}

      <div>
        {trust.bullets.map((line: string, idx: number) => (
          <div key={idx}>{line}</div>
        ))}
      </div>

      {postActivation && <div>{postActivation.reflection}</div>}
    </section>
  );
};
