// modules/specter/src/ui/hooks/useSpecterFt1Scenario.ts
import type { SpecterFt1Scenario } from '../types';

interface SpecterFt1Input {
  sessionCount: number | null;
  signalConfidence: number | null;
}

export function useSpecterFt1Scenario(
  input: SpecterFt1Input
): SpecterFt1Scenario {
  const { sessionCount, signalConfidence } = input;

  if (sessionCount === null) {
    return 'LOADING';
  }

  if (sessionCount === 0) {
    return 'NO_SESSIONS';
  }

  if (signalConfidence === null) {
    return 'LOW_SIGNAL';
  }

  return 'HEALTHY';
}