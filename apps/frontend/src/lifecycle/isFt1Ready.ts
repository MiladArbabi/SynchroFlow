//apps/frontend/src/lifecycle/isFt1Ready.ts
import { UILifecyclePhase } from './types';

export function isFt1Ready(phase: UILifecyclePhase): boolean {
  return phase === 'FT1_READY';
}
