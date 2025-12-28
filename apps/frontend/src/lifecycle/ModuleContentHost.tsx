//apps/frontend/src/lifecycle/ModuleContentHost.tsx
import React from 'react';

import { UILifecyclePhase } from './types';
import { Ft1OnboardingGate } from './Ft1OnboardingGate';

/**
 * ModuleContentHost
 * -----------------
 * Decides WHICH module content blocks are mounted
 * based on lifecycle phase + entitlements.
 *
 * HARD RULES:
 * - No module receives lifecycle info
 * - No module receives entitlement info
 * - No module branches on FT
 * - FT progression is additive mounting
 */

interface ModuleContentHostProps {
  moduleId: string;
  phase: UILifecyclePhase;
  hasPaidEntitlement: boolean;
  onboarding?: {
    ft1?: {
      isComplete: boolean;
      blockingModules: string[];
    };
  };
}

export function ModuleContentHost({
  moduleId,
  phase,
  hasPaidEntitlement,
  onboarding,
}: ModuleContentHostProps) {

  const ft1Incomplete =
    phase === 'FT1_READY' &&
    onboarding?.ft1?.isComplete === false &&
    onboarding?.ft1?.blockingModules?.includes(moduleId);

  // FT1 onboarding gate: suppress core content for blocking modules only
  if (ft1Incomplete) {
    return <Ft1OnboardingGate moduleId={moduleId} />;
  }

  // FT2 unpaid → nothing mounts (paywall handled upstream)
  if (phase === 'FT2_PAYWALL' && !hasPaidEntitlement) {
    return null;
  }

  return (
    <>
      {/* FT1+ core content */}
      <div data-testid={`${moduleId}-core`} />

      {/* FT2+ advanced content */}
      {hasPaidEntitlement && (
        <div data-testid={`${moduleId}-advanced`} />
      )}
    </>
  );
}
