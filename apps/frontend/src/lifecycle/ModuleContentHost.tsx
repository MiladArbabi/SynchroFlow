/* eslint-disable @typescript-eslint/no-unused-vars */
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

const __DEV__ = import.meta.env.DEV;

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

    if (
    __DEV__ &&
    phase !== 'FT2_READY' &&
    document.querySelector(`[data-testid="${moduleId}-advanced"]`)
  ) {
    throw new Error(
      `[Lifecycle Violation] Advanced content attempted to mount for module "${moduleId}" outside FT2_READY. Current phase: ${phase}`
    );
  }

  return (
    <>
      {/* FT1 onboarding gate (additive, never suppressive) */}
      {ft1Incomplete && (
        <Ft1OnboardingGate moduleId={moduleId} />
      )}

      {/* FT1+ core content */}
      <div data-testid={`${moduleId}-core`} />

      {/* FT2 capability content */}
      {phase === 'FT2_READY' && (
        <div data-testid={`${moduleId}-advanced`} />
      )}
    </>
  );
}
