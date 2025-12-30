//apps/backend/src/onboarding/providers/specter.provider.ts
import {
  ReadinessSignal,
} from '@lasyncro/shared';

import type { OnboardingSignalProvider } from '../readiness.providers';
import { createSessionStore } from 'modules-specter/store/session-store';

// --- Specter provider: FT1 readiness ONLY ---
export const specterOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'specter',

  async getSignals({ shopId }: { shopId: number }): Promise<ReadinessSignal[]> {
    let sessionsKnown = false;
    let sessionCount: number | null = null;

    try {
      const store = createSessionStore();
      const sessions = await store.getSessionsLastNDays(shopId, 7);
      sessionCount = Array.isArray(sessions) ? sessions.length : 0;
      sessionsKnown = true;
    } catch {
      sessionsKnown = false;
      sessionCount = null;
    }

    return [
      {
        name: 'specter.sessionsKnown',
        value: sessionsKnown,
      },
      {
        name: 'specter.sessionCount',
        value: sessionCount,
      },
      {
        name: 'specter.signalConfidence',
        value: null, // FT1: explicitly unknown
      },
    ];
  },
};
