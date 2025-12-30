// apps/frontend/src/lifecycle/Ft1ChecklistDataSurface.tsx

import React from 'react';
import { Ft1ChecklistShell } from './Ft1ChecklistShell';
import { useOnboardingReadiness } from './useOnboardingReadiness';
import { mapFt1Checklist } from 'wiring/ft1ChecklistAdapter';

interface Ft1ChecklistSurfaceProps {
  shopId: number;
}

/**
 * Ft1ChecklistSurface
 * -------------------
 * Data surface for FT1 onboarding checklist.
 *
 * Responsibilities:
 * - Fetch onboarding readiness
 * - Adapt backend snapshot → checklist model
 * - Render Ft1ChecklistShell
 *
 * HARD RULES:
 * - No dev stubs
 * - No lifecycle inference
 * - No routing
 * - No side effects
 */
export function Ft1ChecklistDataSurface({ shopId }: Ft1ChecklistSurfaceProps) {
  const readinessQuery = useOnboardingReadiness(true, shopId);

  if (!readinessQuery.isSuccess) {
    return null;
  }

  const checklist = mapFt1Checklist(readinessQuery.data);

  return <Ft1ChecklistShell checklist={checklist} />;
}