/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SpecterModuleProps } from '@lasyncro/specter';

/**
 * FT1 Specter Adapter (LOCKED)
 * ---------------------------
 * Pure mapping function:
 * onboarding-readiness payload → SpecterModuleProps
 *
 * - NO hooks
 * - NO lifecycle logic
 * - NO loading logic
 * - NO FT inference
 *
 * Backend is the source of truth.
 */

export function mapSpecterFt1Props(
  readinessData: any
): SpecterModuleProps {
  const specterModule = readinessData?.modules?.find(
    (m: any) => m.moduleId === 'specter'
  );

  const signals = specterModule?.signals ?? [];
  const get = (name: string) =>
    signals.find((s: any) => s.name === name)?.value;

  const sessionsKnown = get('specter.sessionsKnown') === true;
  const rawSessionCount = get('specter.sessionCount');

  return {
    sessionCount:
      !sessionsKnown || rawSessionCount === undefined
        ? null
        : Number(rawSessionCount),

    signalConfidence: get('specter.signalConfidence') ?? null,
  };
}
