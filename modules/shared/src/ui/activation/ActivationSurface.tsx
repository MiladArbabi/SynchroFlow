// modules/shared/src/ui/activation/ActivationSurface.tsx

import React from 'react';

type Slot = {
  content?: React.ReactNode;
};

export interface ActivationSurfaceProps {
  moduleId: string;

  identity?: {
    title: string;
  };

  blindness: Slot;

  absenceProof?: Slot;

  valueAfterActivation?: Slot;

  momentum?: Slot;

  primaryCTA: {
    label: string;
    onActivate: () => void;
  };

  trust: {
    bullets: string[];
  };

  commitmentGradient?: Slot;

  postActivation?: Slot;
}

export const ActivationSurface: React.FC<ActivationSurfaceProps> = (props) => {
  const {
    moduleId,
    identity,
    blindness,
    absenceProof,
    valueAfterActivation,
    momentum,
    primaryCTA,
    trust,
    commitmentGradient,
    postActivation,
  } = props as any;

  // ---- Hard doctrine enforcement ----
  if (!blindness) {
    throw new Error('ActivationSurface: blindness slot is required');
  }

  if (!primaryCTA) {
    throw new Error('ActivationSurface: primaryCTA slot is required');
  }

  if (!trust) {
    throw new Error('ActivationSurface: trust slot is required');
  }

  return (
    <section data-testid="activation-surface">
      {/* Identity */}
      {identity && <h1>{identity.title}</h1>}

      {/* Blindness (mandatory) */}
      <div data-testid="activation-blindness">
        {blindness.content}
      </div>

      {/* Absence Proof */}
      {absenceProof && (
        <div data-testid="activation-absence">
          {absenceProof.content}
        </div>
      )}

      {/* Value After Activation */}
      {valueAfterActivation && (
        <div data-testid="activation-value">
          {valueAfterActivation.content}
        </div>
      )}

      {/* Momentum (optional) */}
      {momentum && (
        <div data-testid="activation-momentum">
          {momentum.content}
        </div>
      )}

      {/* Primary CTA (singular) */}
      <div data-testid="activation-cta">
        <button onClick={primaryCTA.onActivate}>
          {primaryCTA.label}
        </button>
      </div>

      {/* Trust (must be immediately under CTA) */}
      <div data-testid="activation-trust">
        {trust.bullets.map((line: string, idx: number) => (
          <div key={idx}>{line}</div>
        ))}
      </div>

      {/* Commitment Gradient */}
      {commitmentGradient && (
        <div data-testid="activation-commitment">
          {commitmentGradient.content}
        </div>
      )}

      {/* Post Activation */}
      {postActivation && (
        <div data-testid="activation-post">
          {postActivation.content}
        </div>
      )}
    </section>
  );
};