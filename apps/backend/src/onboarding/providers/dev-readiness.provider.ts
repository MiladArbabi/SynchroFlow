import { ReadinessSignal } from '@lasyncro/shared';
import type { OnboardingSignalProvider } from '../readiness.providers';

export const devReadinessOverrideProvider: OnboardingSignalProvider = {
  moduleId: 'platform',

  async getSignals(): Promise<ReadinessSignal[]> {
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }

    return [
      // --- PLATFORM (FT1 gate) ---
      { name: 'integration.connected', value: true },
      { name: 'integration.syncCompleted', value: true },
    ];
  },
};